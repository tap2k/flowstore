import type { ChatUsage } from "@flowstore/core/llm/types";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import { addUsage } from "@flowstore/core/runtime/promptClient";
import type { CellState, ModelDispatch, Scenario } from "./types";

// Headless Gemini Live driver for an s2s column: the scenario's user turns go
// in as TEXT (shared with the text columns — same suite, different modality),
// the model responds in AUDIO, and the output transcription stream reduces to
// the same TranscriptTurn shape runCell produces. No mic, no playback — this
// is the compare cell, not the simulate panel (that's browser/voiceSession).
//
// Latency per turn is send→first server evidence (audio chunk or
// transcription text) — the "time to first audio" a caller would feel, which
// is the number the text columns can't measure.

// Structural mirror of @google/genai's LiveServerMessage, kept local so the
// reducer (and its tests) never import the SDK.
export type LiveServerEvent = {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    responseTokenCount?: number;
    promptTokensDetails?: { modality?: string; tokenCount?: number }[];
    responseTokensDetails?: { modality?: string; tokenCount?: number }[];
  };
};

// Map Live usageMetadata to ChatUsage: TEXT details → inputTokens/outputTokens
// (kept text-only), AUDIO details → audioInputTokens/audioOutputTokens. When
// the modality breakdown is absent, fall back to the flat prompt/response
// counts as text so tokens are never silently dropped.
export function usageFromLiveMetadata(
  meta: NonNullable<LiveServerEvent["usageMetadata"]>,
): ChatUsage {
  const byModality = (details: { modality?: string; tokenCount?: number }[] | undefined) => {
    let text = 0;
    let audio = 0;
    let seen = false;
    for (const d of details ?? []) {
      seen = true;
      if ((d.modality ?? "").toUpperCase().includes("AUDIO")) audio += d.tokenCount ?? 0;
      else text += d.tokenCount ?? 0;
    }
    return seen ? { text, audio } : null;
  };
  const input = byModality(meta.promptTokensDetails);
  const output = byModality(meta.responseTokensDetails);
  return {
    inputTokens: input ? input.text : (meta.promptTokenCount ?? 0),
    outputTokens: output ? output.text : (meta.responseTokenCount ?? 0),
    ...(input && input.audio > 0 ? { audioInputTokens: input.audio } : {}),
    ...(output && output.audio > 0 ? { audioOutputTokens: output.audio } : {}),
  };
}

// latencyMs = send→first audio (how fast the reply FEELS — the per-reply
// chip and the report's latency column). wallMs = send→turnComplete (how
// long the turn actually HOLDS the line — audio streams near real-time, so
// a 1s-to-first-audio reply can still take 20s of wall). totalMs sums wall,
// matching the text path's full-round-trip semantics.
export type LiveTurnResult = {
  text: string;
  usage?: ChatUsage;
  latencyMs?: number;
  wallMs?: number;
  // The turn's spoken audio: base64 PCM16 chunks in stream order (Live
  // output format — 24kHz mono). The surface decides what to do with them
  // (compare wraps a WAV for replay); the engine never decodes audio.
  audioChunks?: string[];
};

// Live API output audio format (fixed by the protocol).
export const LIVE_AUDIO_SAMPLE_RATE = 24000;

// Reduces the interleaved Live message stream into completed agent turns.
// One instance per session; feed() every message, and it invokes onTurn when
// the server marks a turn complete. usageMetadata is read as per-generation
// (each turn's final messages carry that turn's counts) — the latest snapshot
// seen during a turn wins, summed across turns by the caller.
export class LiveTurnCollector {
  private agentBuf = "";
  private turnUsage: ChatUsage | undefined;
  private sentAt: number | null = null;
  private latencyMs: number | undefined;
  private audioChunks: string[] = [];
  ready = false;

  constructor(private onTurn: (turn: LiveTurnResult) => void) {}

  // Stamp when a user turn is sent: first response marks latency; the stamp
  // itself anchors wall time until turnComplete.
  markSent(now: number): void {
    this.sentAt = now;
    this.latencyMs = undefined;
  }

  feed(msg: LiveServerEvent, now: number): void {
    if (msg.setupComplete) this.ready = true;
    const content = msg.serverContent;

    let hasAudio = false;
    for (const p of content?.modelTurn?.parts ?? []) {
      if (p.inlineData?.data) {
        hasAudio = true;
        this.audioChunks.push(p.inlineData.data);
      }
    }
    const text = content?.outputTranscription?.text ?? "";
    if ((hasAudio || text) && this.latencyMs === undefined && this.sentAt !== null) {
      this.latencyMs = Math.round(now - this.sentAt);
    }
    if (text) this.agentBuf += text;

    if (msg.usageMetadata) this.turnUsage = usageFromLiveMetadata(msg.usageMetadata);

    if (content?.turnComplete) {
      const turn: LiveTurnResult = {
        text: this.agentBuf.trim(),
        usage: this.turnUsage,
        latencyMs: this.latencyMs,
        wallMs: this.sentAt !== null ? Math.round(now - this.sentAt) : undefined,
        ...(this.audioChunks.length > 0 ? { audioChunks: this.audioChunks } : {}),
      };
      this.agentBuf = "";
      this.turnUsage = undefined;
      this.sentAt = null;
      this.latencyMs = undefined;
      this.audioChunks = [];
      this.onTurn(turn);
    }
  }
}

const SETUP_TIMEOUT_MS = 20_000;
const TURN_TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s.`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Same contract as runCell (status patches through onUpdate; cooperative
// signal at turn boundaries). Live cells never resume mid-conversation — a
// closed Live session can't be re-seeded faithfully, so a stopped cell
// restarts its scenario from the top.
export async function runLiveCell(args: {
  systemPrompt: string;
  scenario: Scenario;
  dispatch: ModelDispatch;
  onUpdate: (patch: Partial<CellState>) => void;
  // Spoken-reply sink: called with each completed agent turn's audio chunks,
  // keyed by the turn's ts (the id the transcript UI already carries).
  // Session-scoped by nature — audio never enters CellState or persistence.
  onAudio?: (turnTs: number, chunks: string[]) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { systemPrompt, scenario, dispatch, onUpdate, onAudio, signal } = args;
  const history: TranscriptTurn[] = [];
  let usage: ChatUsage | undefined;
  let totalMs = 0;
  onUpdate({ status: "running", turns: [], usage, totalMs, error: undefined });

  // Waiters bridge the callback stream to the sequential turn loop.
  let resolveTurn: ((t: LiveTurnResult) => void) | null = null;
  let resolveReady: (() => void) | null = null;
  let failSession: ((e: Error) => void) | null = null;
  const collector = new LiveTurnCollector((turn) => {
    resolveTurn?.(turn);
    resolveTurn = null;
  });

  // SDK loaded lazily: only a live run pays for it, and importing the engine
  // (runner → liveCell) stays side-effect-free for node tests.
  const { GoogleGenAI, Modality } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: dispatch.apiKey });

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    failSession = reject;
  });

  let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
  try {
    session = await ai.live.connect({
      model: dispatch.wireModel,
      callbacks: {
        onmessage: (msg: unknown) => {
          collector.feed(msg as LiveServerEvent, Date.now());
          if (collector.ready) {
            resolveReady?.();
            resolveReady = null;
          }
        },
        onerror: (e: { message?: string }) => {
          failSession?.(new Error(e.message || "Live socket error."));
        },
        onclose: () => {
          failSession?.(new Error("Live session closed unexpectedly."));
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: systemPrompt,
        outputAudioTranscription: {},
      },
    });
    await withTimeout(ready, SETUP_TIMEOUT_MS, "Live session setup");

    for (const userText of scenario.turns) {
      if (signal?.aborted) break;
      const userTurn: TranscriptTurn = { role: "user", text: userText, ts: Date.now(), events: [] };
      onUpdate({ turns: [...history, userTurn] });

      const turnDone = new Promise<LiveTurnResult>((resolve, reject) => {
        resolveTurn = resolve;
        failSession = reject;
      });
      collector.markSent(Date.now());
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: userText }] }],
        turnComplete: true,
      });
      const res = await withTimeout(turnDone, TURN_TIMEOUT_MS, "Live turn");
      if (signal?.aborted) break;

      totalMs += res.wallMs ?? res.latencyMs ?? 0;
      usage = addUsage(usage, res.usage);
      const agentTurn: TranscriptTurn = {
        role: "agent",
        text: res.text,
        ts: Date.now(),
        events: [],
        latencyMs: res.latencyMs,
      };
      history.push(userTurn, agentTurn);
      if (res.audioChunks && onAudio) onAudio(agentTurn.ts, res.audioChunks);
      onUpdate({ turns: [...history], usage, totalMs });
    }
    // A stopped live cell reverts to idle with whatever completed; it will
    // rerun from scratch (no resume), so partial turns are display-only.
    onUpdate(signal?.aborted ? { status: "idle", turns: [...history] } : { status: "done" });
  } catch (err) {
    onUpdate({ status: "error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    failSession = null;
    resolveTurn = null;
    try {
      session?.close();
    } catch {
      // already closed
    }
  }
}
