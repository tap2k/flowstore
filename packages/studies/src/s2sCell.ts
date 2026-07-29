import type { ChatUsage } from "@flowstore/core/llm/types";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import { addUsage } from "@flowstore/core/runtime/promptClient";
import type { CellState, ModelDispatch, Scenario } from "./types";

// Shared skeleton for headless s2s compare cells (Gemini Live, OpenAI
// Realtime): the scenario's user turns go in as TEXT (same suite as the text
// columns — different modality), the model responds in AUDIO, and the
// vendor's transcription stream reduces to the same TranscriptTurn shape
// runCell produces. No mic, no playback — this is the compare cell, not the
// simulate panel. Each vendor contributes only a parser (event stream →
// TurnAccumulator calls) and a transport (connect/sendUserTurn/close); the
// turn loop, timeouts, latency/wall bookkeeping, and CellState protocol live
// here once.

// latencyMs = send→first audio (how fast the reply FEELS — the per-reply
// chip and the report's latency column). wallMs = send→turn-complete (how
// long the turn actually HOLDS the line — s2s sockets pace audio near real
// time, so a 1s-to-first-audio reply can still take 20s of wall). totalMs
// sums wall, matching the text path's full-round-trip semantics.
export type S2sTurn = {
  text: string;
  usage?: ChatUsage;
  latencyMs?: number;
  wallMs?: number;
  // The turn's spoken audio: base64 PCM16 chunks in stream order (both
  // vendors emit 24kHz mono). The surface decides what to do with them
  // (compare wraps a WAV for replay); the engine never decodes audio.
  audioChunks?: string[];
};

// Output audio format shared by Gemini Live and OpenAI Realtime (pcm16).
export const LIVE_AUDIO_SAMPLE_RATE = 24000;

// Accumulates one agent turn from a vendor parser's calls and flushes it as
// an S2sTurn on complete(). Usage is read as per-generation (each turn's
// final events carry that turn's counts) — the latest snapshot wins, summed
// across turns by the cell loop.
export class TurnAccumulator {
  private agentBuf = "";
  private turnUsage: ChatUsage | undefined;
  private sentAt: number | null = null;
  private latencyMs: number | undefined;
  private audioChunks: string[] = [];

  constructor(private onTurn: (turn: S2sTurn) => void) {}

  // Stamp when a user turn is sent: first response marks latency; the stamp
  // itself anchors wall time until the turn completes.
  markSent(now: number): void {
    this.sentAt = now;
    this.latencyMs = undefined;
  }

  addAudio(chunk: string, now: number): void {
    this.audioChunks.push(chunk);
    this.markResponded(now);
  }

  addText(text: string, now: number): void {
    if (!text) return;
    this.agentBuf += text;
    this.markResponded(now);
  }

  setUsage(usage: ChatUsage): void {
    this.turnUsage = usage;
  }

  complete(now: number): void {
    const turn: S2sTurn = {
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

  private markResponded(now: number): void {
    if (this.latencyMs === undefined && this.sentAt !== null) {
      this.latencyMs = Math.round(now - this.sentAt);
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

// What a vendor transport hands back: send a user turn (stamping the
// accumulator's clock itself) and close.
export type S2sSession = {
  sendUserTurn: (text: string) => void;
  close: () => void;
};

export type S2sConnect = (args: {
  dispatch: ModelDispatch;
  systemPrompt: string;
  // The transport builds its parser around these: completed turns, session
  // readiness (safe to send), fatal errors (rejects the pending waiter).
  onTurn: (turn: S2sTurn) => void;
  onReady: () => void;
  onFatal: (e: Error) => void;
}) => Promise<S2sSession>;

export type RunS2sCellArgs = {
  systemPrompt: string;
  scenario: Scenario;
  dispatch: ModelDispatch;
  onUpdate: (patch: Partial<CellState>) => void;
  // Spoken-reply sink: called with each completed agent turn's audio chunks,
  // keyed by the turn's ts (the id the transcript UI already carries).
  // Session-scoped by nature — audio never enters CellState or persistence.
  onAudio?: (turnTs: number, chunks: string[]) => void;
  signal?: AbortSignal;
};

// Same contract as runCell (status patches through onUpdate; cooperative
// signal at turn boundaries). S2s cells never resume mid-conversation — a
// closed session can't be re-seeded faithfully, so a stopped cell restarts
// its scenario from the top.
export async function runS2sCell(
  args: RunS2sCellArgs,
  connect: S2sConnect,
  what: string,
): Promise<void> {
  const { systemPrompt, scenario, dispatch, onUpdate, onAudio, signal } = args;
  const history: TranscriptTurn[] = [];
  let usage: ChatUsage | undefined;
  let totalMs = 0;
  onUpdate({ status: "running", turns: [], usage, totalMs, error: undefined });

  // Waiters bridge the callback stream to the sequential turn loop.
  let resolveTurn: ((t: S2sTurn) => void) | null = null;
  let resolveReady: (() => void) | null = null;
  let failSession: ((e: Error) => void) | null = null;

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    failSession = reject;
  });

  let session: S2sSession | null = null;
  try {
    session = await connect({
      dispatch,
      systemPrompt,
      onTurn: (turn) => {
        resolveTurn?.(turn);
        resolveTurn = null;
      },
      onReady: () => {
        resolveReady?.();
        resolveReady = null;
      },
      onFatal: (e) => failSession?.(e),
    });
    await withTimeout(ready, SETUP_TIMEOUT_MS, `${what} session setup`);

    for (const userText of scenario.turns) {
      if (signal?.aborted) break;
      const userTurn: TranscriptTurn = { role: "user", text: userText, ts: Date.now(), events: [] };
      onUpdate({ turns: [...history, userTurn] });

      const turnDone = new Promise<S2sTurn>((resolve, reject) => {
        resolveTurn = resolve;
        failSession = reject;
      });
      session.sendUserTurn(userText);
      const res = await withTimeout(turnDone, TURN_TIMEOUT_MS, `${what} turn`);
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
    // A stopped s2s cell reverts to idle with whatever completed; it will
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
