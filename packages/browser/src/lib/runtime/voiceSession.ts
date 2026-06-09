// Browser-direct voice session for the Simulation panel (prompt mode, no
// runner). Feeds the compiled monolith system prompt to a Gemini Live bidi
// audio socket, captures the mic, plays back the model's audio, and reduces
// the Live transcription stream into the same TranscriptTurn shape the text
// path produces. Capabilities ride the Live function-calling channel and
// resolve through the same mock machinery as text mode.
//
// This is the monolith voice path — there is no per-flow hand-off at runtime,
// so the runner's source-silence problem doesn't arise here (see TODO T2a).
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import type { ToolDefinition } from "@flowstore/core/llm/types";
import type { CapabilityInvocation } from "@flowstore/core/runtime/promptClient";

export type VoicePhase = "listening" | "speaking" | "idle";
export type VoiceStatus = "connecting" | "ready" | "closed" | "error";

export interface VoiceSessionConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  // Resolves a capability tool call to a JSON-serializable mock result —
  // the store passes resolveMockedCall bound to the current mocks/errors.
  resolveTool: (name: string, args: Record<string, unknown>) => unknown;
  // When the agent speaks first: trigger one model generation right after
  // connect so it greets without waiting for user audio (the voice analog of
  // text mode's synthetic [begin] turn).
  chatbotInitiates?: boolean;
  language?: string;
  onUserTurn: (text: string) => void;
  // latencyMs: time from the user finishing their turn to the agent's first
  // response (audio or transcription) — the voice analog of text's
  // send→response latency. undefined when there's no preceding user turn to
  // measure from (e.g. the chatbot_initiates opener).
  onAgentTurn: (text: string, capabilities: CapabilityInvocation[], latencyMs?: number) => void;
  onPhase: (phase: VoicePhase) => void;
  onStatus: (status: VoiceStatus) => void;
  onError: (message: string) => void;
}

export class VoiceSession {
  private session: Session | null = null;
  private mic: import("./audio").MicCapture | null = null;
  private player: import("./audio").AudioPlayer | null = null;
  private closed = false;

  // Accumulators for the interleaved transcription stream. A user turn flushes
  // when the agent starts responding; an agent turn flushes on turnComplete.
  private userBuf = "";
  private agentBuf = "";
  private pendingCapabilities: CapabilityInvocation[] = [];

  // Latency tracking, reset each turn. lastInputAt marks the most recent user
  // speech (a proxy for "user stopped talking"); turnLatencyMs is captured the
  // first time the agent responds, measured from there.
  private lastInputAt: number | null = null;
  private respondedThisTurn = false;
  private turnLatencyMs: number | undefined = undefined;

  constructor(private cfg: VoiceSessionConfig) {}

  async start(): Promise<void> {
    this.cfg.onStatus("connecting");
    // Import the audio plumbing lazily so a text-only session never pulls Web
    // Audio code (and so SSR/build doesn't touch AudioContext).
    const { MicCapture, AudioPlayer } = await import("./audio");
    this.player = new AudioPlayer((playing) => {
      if (this.closed) return;
      this.cfg.onPhase(playing ? "speaking" : "idle");
    });

    const ai = new GoogleGenAI({ apiKey: this.cfg.apiKey });
    const functionDeclarations = this.cfg.tools.map((t: ToolDefinition) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: t.parameters,
    }));

    try {
      this.session = await ai.live.connect({
        model: this.cfg.model,
        callbacks: {
          onopen: () => {
            if (!this.closed) this.cfg.onStatus("ready");
          },
          onmessage: (msg: LiveServerMessage) => this.handleMessage(msg),
          onerror: (e: ErrorEvent) => {
            if (!this.closed) this.cfg.onError(e.message || "Live socket error.");
          },
          onclose: () => {
            if (!this.closed) this.cfg.onStatus("closed");
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: this.cfg.systemPrompt,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          ...(functionDeclarations.length > 0
            ? { tools: [{ functionDeclarations }] }
            : {}),
        },
      });
    } catch (e) {
      this.cfg.onError(e instanceof Error ? e.message : "Failed to open voice session.");
      throw e;
    }

    // Agent-speaks-first: kick one generation so the model greets without
    // waiting for the user. The "[begin]" text mirrors text mode's synthetic
    // opener turn (the Live API needs at least one turn to start; the system
    // prompt shapes the actual greeting). It's injected as client content,
    // not audio, so it never produces an input transcription → no user bubble.
    // Stamp lastInputAt so the opener still gets a time-to-first-audio reading.
    if (this.cfg.chatbotInitiates) {
      this.lastInputAt = performance.now();
      this.session?.sendClientContent({
        turns: [{ role: "user", parts: [{ text: "[begin]" }] }],
        turnComplete: true,
      });
    }

    // Start the mic only once the socket is live, streaming PCM16 frames up.
    this.mic = new MicCapture((base64Pcm16) => {
      this.session?.sendRealtimeInput({
        audio: { data: base64Pcm16, mimeType: `audio/pcm;rate=16000` },
      });
    });
    try {
      await this.mic.start();
    } catch (e) {
      this.cfg.onError(
        e instanceof Error ? `Mic access failed: ${e.message}` : "Mic access failed.",
      );
      throw e;
    }
  }

  setMuted(muted: boolean): void {
    if (this.mic) this.mic.muted = muted;
  }

  stop(): void {
    this.closed = true;
    this.mic?.stop();
    this.player?.close();
    try {
      this.session?.close();
    } catch {
      // already closed
    }
    this.session = null;
    this.mic = null;
    this.player = null;
  }

  private handleMessage(msg: LiveServerMessage): void {
    if (this.closed) return;
    const content = msg.serverContent;

    // Agent audio out → playback queue. The first audio chunk also marks the
    // response start for latency (audio usually leads the transcription).
    const parts = content?.modelTurn?.parts ?? [];
    for (const part of parts) {
      const data = part.inlineData?.data;
      if (data) {
        this.markResponded();
        this.player?.enqueue(data);
      }
    }

    // Barge-in: the model says a user utterance interrupted it. Drop queued
    // audio so we stop speaking immediately (the monolith analog of the
    // runner's destination-owns-the-utterance rule, but here it's just the
    // one continuous model correcting itself — nothing to un-say across a
    // flow boundary).
    if (content?.interrupted) this.player?.flush();

    // Interleaved transcription. User text accumulates; when the agent begins
    // responding we flush the user turn, then accumulate the agent turn.
    const userText = content?.inputTranscription?.text;
    if (userText) {
      this.userBuf += userText;
      this.lastInputAt = performance.now();
      this.cfg.onPhase("listening");
    }
    const agentText = content?.outputTranscription?.text;
    if (agentText) {
      this.markResponded();
      this.flushUserTurn();
      this.agentBuf += agentText;
    }

    if (content?.turnComplete) {
      this.flushUserTurn();
      this.flushAgentTurn();
    }

    // Capability calls — resolve against the mocks and answer the socket.
    const calls = msg.toolCall?.functionCalls ?? [];
    if (calls.length > 0) {
      const responses = calls.map((call) => {
        const name = call.name ?? "";
        const args = (call.args ?? {}) as Record<string, unknown>;
        const result = this.cfg.resolveTool(name, args);
        this.pendingCapabilities.push({ name, args, result });
        return { id: call.id, name, response: { result } };
      });
      this.session?.sendToolResponse({ functionResponses: responses });
    }
  }

  private flushUserTurn(): void {
    const text = this.userBuf.trim();
    this.userBuf = "";
    if (text) this.cfg.onUserTurn(text);
  }

  private flushAgentTurn(): void {
    const text = this.agentBuf.trim();
    const caps = this.pendingCapabilities;
    const latencyMs = this.turnLatencyMs;
    this.agentBuf = "";
    this.pendingCapabilities = [];
    // Emit if there's spoken text OR capabilities fired (a silent tool turn
    // still belongs in the timeline).
    if (text || caps.length > 0) this.cfg.onAgentTurn(text, caps, latencyMs);
    // Reset latency tracking for the next exchange.
    this.lastInputAt = null;
    this.respondedThisTurn = false;
    this.turnLatencyMs = undefined;
    this.cfg.onPhase("idle");
  }

  // Capture response latency the first time the agent reacts this turn,
  // measured from the user's last speech. Idempotent within a turn.
  private markResponded(): void {
    if (this.respondedThisTurn) return;
    this.respondedThisTurn = true;
    if (this.lastInputAt != null) {
      this.turnLatencyMs = Math.round(performance.now() - this.lastInputAt);
    }
  }
}
