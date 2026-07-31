// Interactive voice session over the OpenAI-Realtime protocol — the
// GPT Realtime / Grok Voice sibling of voiceSession.ts (Gemini Live). Same
// contract as VoiceSession: mic in, live playback out, transcript turns
// reduced into the store's shape, capabilities over the function-calling
// channel. Socket URL + credential transit come from the engine's vendor
// table (realtimeSocketInfo); the session dialect here adds what the
// compare cells don't need — mic input, server VAD, transcription, tools.
import { realtimeSocketInfo } from "@flowstore/studies";
import type { ToolDefinition } from "@flowstore/core/llm/types";
import type { CapabilityInvocation } from "@flowstore/core/runtime/promptClient";
import type { VoicePhase, VoiceStatus } from "./voiceSession";

// The Realtime vendors speak 24k PCM on both directions.
const RATE = 24000;

// The endpoints simulate's voice mode can actually drive — the picker's
// voiceOnly filter and the store's gate both consume THIS set, so they
// can't drift apart (a project entry may tag voice on any endpoint).
export const VOICE_PROVIDERS: ReadonlySet<string> = new Set(["google", "openai", "xai"]);

export interface RealtimeVoiceSessionConfig {
  provider: "openai" | "xai";
  apiKey: string;
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  resolveTool: (name: string, args: Record<string, unknown>) => Promise<unknown> | unknown;
  chatbotInitiates?: boolean;
  // Speaker persona (vendor namespace); blank/absent = vendor default.
  voice?: string;
  onUserTurn: (text: string) => void;
  onAgentTurn: (
    text: string,
    capabilities: CapabilityInvocation[],
    latencyMs?: number,
    audioChunks?: string[],
  ) => void;
  onPhase: (phase: VoicePhase) => void;
  onStatus: (status: VoiceStatus) => void;
  onError: (message: string) => void;
}

type Evt = {
  type?: string;
  delta?: string;
  transcript?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  error?: { message?: string };
  response?: {
    output?: { content?: { transcript?: string; text?: string }[] }[];
  };
};

export class RealtimeVoiceSession {
  private ws: WebSocket | null = null;
  private mic: import("./audio").MicCapture | null = null;
  private player: import("./audio").AudioPlayer | null = null;
  private closed = false;

  private userBuf = "";
  private agentBuf = "";
  private sawAgentDelta = false;
  private audioChunks: string[] = [];
  private pendingCapabilities: CapabilityInvocation[] = [];

  // Latency: user stops speaking (server VAD speech_stopped) → first agent
  // audio. The opener stamps at send instead.
  private lastInputAt: number | null = null;
  private respondedThisTurn = false;
  private turnLatencyMs: number | undefined = undefined;

  private readySent = false;
  private queue: Promise<void> = Promise.resolve();
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private cfg: RealtimeVoiceSessionConfig) {}

  async start(): Promise<void> {
    this.cfg.onStatus("connecting");
    const { MicCapture, AudioPlayer } = await import("./audio");
    this.player = new AudioPlayer((playing) => {
      if (this.closed) return;
      this.cfg.onPhase(playing ? "speaking" : "idle");
    });

    const info = realtimeSocketInfo(this.cfg.provider);
    let protocols: string[];
    try {
      protocols = await info.subprotocols(this.cfg.apiKey);
    } catch (e) {
      this.cfg.onError(e instanceof Error ? e.message : `${info.name} auth failed.`);
      this.stop();
      throw e;
    }
    // A vendor that silently ignores our session.update must not leave the
    // UI at "connecting" with a hot mic — fail loudly instead.
    this.readyTimer = setTimeout(() => {
      if (!this.readySent && !this.closed) {
        this.cfg.onError(`${info.name} never acknowledged the session.`);
        this.stop();
      }
    }, 15_000);
    const ws = new WebSocket(`${info.url}?model=${encodeURIComponent(this.cfg.model)}`, protocols);
    this.ws = ws;
    ws.onopen = () => this.sendSessionUpdate();
    ws.onmessage = (e: MessageEvent) => {
      let evt: Evt;
      try {
        evt = JSON.parse(typeof e.data === "string" ? e.data : "") as Evt;
      } catch {
        return;
      }
      // Serialized: handle() awaits resolveTool, and response.done follows
      // function_call_arguments.done immediately — unserialized, the flush
      // would run before the capability resolved and strip it from its turn.
      this.queue = this.queue.then(() => this.handle(evt));
    };
    ws.onerror = () => {
      if (!this.closed) this.cfg.onError(`${info.name} socket error.`);
    };
    ws.onclose = () => {
      if (!this.closed) this.cfg.onStatus("closed");
    };

    // Mic starts immediately; frames sent before the socket opens are
    // DROPPED by send()'s readyState guard — in practice getUserMedia's
    // permission prompt outlasts the handshake, and F4's ready timeout
    // covers the failure case. Server VAD owns turn-taking.
    this.mic = new MicCapture((b64) => {
      this.send({ type: "input_audio_buffer.append", audio: b64 });
    }, RATE);
    try {
      await this.mic.start();
    } catch (e) {
      this.cfg.onError(e instanceof Error ? `Mic access failed: ${e.message}` : "Mic access failed.");
      this.stop();
      throw e;
    }
  }

  setMuted(muted: boolean): void {
    if (this.mic) this.mic.muted = muted;
  }

  stop(): void {
    this.closed = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.mic?.stop();
    this.player?.close();
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
    this.ws = null;
    this.mic = null;
    this.player = null;
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private sendSessionUpdate(): void {
    const tools = this.cfg.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    const audio = {
      input: { format: { type: "audio/pcm", rate: RATE } },
      output: { format: { type: "audio/pcm", rate: RATE } },
    };
    // Dialects differ slightly: OpenAI's GA session carries type/modalities
    // and an input-transcription config; xAI's is leaner (transcription is
    // emitted by default, unknown params are rejected loudly).
    const voice = this.cfg.voice?.trim();
    const session =
      this.cfg.provider === "openai"
        ? {
            type: "realtime",
            output_modalities: ["audio"],
            instructions: this.cfg.systemPrompt,
            audio: {
              ...audio,
              input: { ...audio.input, transcription: { model: "gpt-4o-mini-transcribe" } },
              ...(voice ? { output: { ...audio.output, voice } } : {}),
            },
            ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
          }
        : {
            instructions: this.cfg.systemPrompt,
            audio,
            // xAI's server VAD is OFF by default (OpenAI's is on) — without
            // this the buffer holds speech forever and no turn ever ends.
            // Verified live: with it, speech_started/stopped/committed and
            // transcription.completed all flow.
            turn_detection: { type: "server_vad" },
            ...(voice ? { voice } : {}),
            ...(tools.length > 0 ? { tools } : {}),
          };
    this.send({ type: "session.update", session });
  }

  private markResponded(): void {
    if (this.respondedThisTurn) return;
    this.respondedThisTurn = true;
    if (this.lastInputAt != null) {
      this.turnLatencyMs = Math.round(performance.now() - this.lastInputAt);
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
    const audio = this.audioChunks;
    this.agentBuf = "";
    this.sawAgentDelta = false;
    this.pendingCapabilities = [];
    this.audioChunks = [];
    if (text || caps.length > 0) {
      this.cfg.onAgentTurn(text, caps, latencyMs, audio.length > 0 ? audio : undefined);
    }
    this.lastInputAt = null;
    this.respondedThisTurn = false;
    this.turnLatencyMs = undefined;
    this.cfg.onPhase("idle");
  }

  private maybeSendOpener(): void {
    if (!this.cfg.chatbotInitiates) return;
    this.lastInputAt = performance.now();
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: "[begin]" }] },
    });
    this.send({ type: "response.create" });
  }

  private async handle(evt: Evt): Promise<void> {
    if (this.closed) return;
    const t = evt.type ?? "";

    if (t === "error") {
      this.cfg.onError(evt.error?.message || "Realtime error.");
      return;
    }
    if ((t === "session.updated" || t === "session.created") && !this.readySent) {
      // session.updated = our config is acknowledged; created alone counts
      // as a fallback for vendors that never ack.
      if (t === "session.updated" || this.cfg.provider === "xai") {
        this.readySent = true;
        this.cfg.onStatus("ready");
        this.maybeSendOpener();
      }
      return;
    }

    // Server VAD: user speaking → barge-in (drop queued playback).
    if (t === "input_audio_buffer.speech_started") {
      this.player?.flush();
      this.cfg.onPhase("listening");
      return;
    }
    if (t === "input_audio_buffer.speech_stopped") {
      this.lastInputAt = performance.now();
      return;
    }

    // User transcription — OpenAI emits `.completed` (final: flush now),
    // xAI `.updated` (REPLACE semantics: the buffer keeps only the latest
    // full text, and the flush waits for response.done — flushing earlier
    // would emit a truncated prefix as its own bubble, then the full text
    // again).
    if (
      t === "conversation.item.input_audio_transcription.completed" ||
      t === "conversation.item.input_audio_transcription.updated"
    ) {
      if (evt.transcript !== undefined) this.userBuf = evt.transcript;
      if (t.endsWith("completed")) this.flushUserTurn();
      return;
    }

    if (t === "response.output_audio.delta" || t === "response.audio.delta") {
      this.markResponded();
      if (evt.delta) {
        this.player?.enqueue(evt.delta);
        this.audioChunks.push(evt.delta);
      }
      return;
    }
    if (t === "response.output_audio_transcript.delta" || t === "response.audio_transcript.delta") {
      this.markResponded();
      this.sawAgentDelta = true;
      if (evt.delta) this.agentBuf += evt.delta;
      return;
    }

    // Capability call: resolve against the mocks/endpoints, answer, continue.
    if (t === "response.function_call_arguments.done") {
      const name = evt.name ?? "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(evt.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        // leave {}
      }
      const result = await this.cfg.resolveTool(name, args);
      this.pendingCapabilities.push({ name, args, result });
      this.send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: evt.call_id, output: JSON.stringify(result) },
      });
      this.send({ type: "response.create" });
      return;
    }

    if (t === "response.done") {
      this.flushUserTurn();
      // Vendors without transcript deltas (xAI): recover the agent text from
      // the response's output items.
      if (!this.sawAgentDelta) {
        this.agentBuf += (evt.response?.output ?? [])
          .flatMap((o) => o.content ?? [])
          .map((c) => c.transcript ?? c.text ?? "")
          .join("");
      }
      // A tool-call-only response (no audio, no text) is not the end of the
      // agent's turn — response.create was just sent for the spoken answer.
      // Carry the pending capabilities AND the latency anchor into it; a
      // flush here would strip both from the turn they belong to.
      if (!this.agentBuf.trim() && this.audioChunks.length === 0 && this.pendingCapabilities.length > 0) {
        return;
      }
      this.flushAgentTurn();
    }
  }
}
