import type { ChatUsage } from "@flowstore/core/llm/types";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import { addUsage } from "@flowstore/core/runtime/promptClient";
import type { CellState, ModelDispatch, Scenario } from "./types";
import { scriptOf } from "./types";

// Shared skeleton for headless s2s compare cells (Gemini Live, OpenAI
// Realtime): the scenario's user turns go in as TEXT (same suite as the text
// columns — different modality), the model responds in AUDIO, and the
// vendor's transcription stream reduces to the same TranscriptTurn shape
// runCell produces. No mic, no playback — this is the compare cell, not the
// simulate panel. Each vendor contributes only a parser (event stream →
// TurnAccumulator calls) and a transport (connect/sendUserTurn/close); the
// turn loop, timeouts, latency/wall bookkeeping, fatal-error latching, abort
// handling, and the CellState protocol live here once.

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
export const S2S_AUDIO_SAMPLE_RATE = 24000;

// Accumulates one agent turn from a vendor parser's calls and flushes it as
// an S2sTurn on complete(). Usage is read as per-generation (each turn's
// final events carry that turn's counts) — the latest snapshot wins, summed
// across turns by the cell loop. Note the sum's meaning: both vendors bill
// each generation's input over the whole conversation so far, exactly like
// the text path's per-call usage — the summed dollars are what you'd pay.
export class TurnAccumulator {
  private agentBuf = "";
  private turnUsage: ChatUsage | undefined;
  private sentAt: number | null = null;
  private latencyMs: number | undefined;
  private audioChunks: string[] = [];

  constructor(private onTurn: (turn: S2sTurn) => void) {}

  // Stamped by the cell loop when a user turn is sent: first response marks
  // latency; the stamp itself anchors wall time until the turn completes.
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

// What a vendor transport hands back: send a user turn and close. The cell
// loop stamps the accumulator's clock itself, right before sendUserTurn.
export type S2sSession = {
  sendUserTurn: (text: string) => void;
  close: () => void;
};

export type S2sConnect = (args: {
  dispatch: ModelDispatch;
  systemPrompt: string;
  // The transport parses its event stream into these accumulator calls.
  acc: TurnAccumulator;
  // Session readiness (safe to send). Idempotent — call freely.
  onReady: () => void;
  // Fatal transport errors. Safe to call after intentional close (no-op) or
  // repeatedly (first error wins) — transports may report close() naively.
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

const ABORTED = new Error("aborted");

// Same contract as runCell (status patches through onUpdate). Abort closes
// the socket immediately — an s2s session streams (and bills) at speech
// speed, so "stop" must actually hang up, not wait out the turn. S2s cells
// never resume mid-conversation — a closed session can't be re-seeded
// faithfully, so a stopped cell restarts its scenario from the top.
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

  // Failure is LATCHED, not just thrown at the current waiter: a socket
  // death that lands between two waiters (after setup resolves, between
  // turns) would otherwise reject a settled promise and vanish — the loop
  // would then send into a dead socket and stall out the full turn timeout
  // instead of reporting the real cause.
  let fatal: Error | null = null;
  let closing = false;
  let rejectCurrent: ((e: Error) => void) | null = null;
  let resolveTurn: ((t: S2sTurn) => void) | null = null;
  let resolveReady: (() => void) | null = null;

  const onFatal = (e: Error) => {
    if (closing || fatal) return;
    fatal = e;
    rejectCurrent?.(e);
    rejectCurrent = null;
  };
  const abort = () => onFatal(ABORTED);
  signal?.addEventListener("abort", abort);

  const acc = new TurnAccumulator((turn) => {
    resolveTurn?.(turn);
    resolveTurn = null;
  });

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectCurrent = reject;
  });

  let session: S2sSession | null = null;
  try {
    if (signal?.aborted) throw ABORTED;
    session = await connect({
      dispatch,
      systemPrompt,
      acc,
      onReady: () => {
        resolveReady?.();
        resolveReady = null;
      },
      onFatal,
    });
    await withTimeout(ready, SETUP_TIMEOUT_MS, `${what} session setup`);

    for (const userText of scriptOf(scenario)) {
      if (fatal) throw fatal;
      const userTurn: TranscriptTurn = { role: "user", text: userText, ts: Date.now(), events: [] };
      onUpdate({ turns: [...history, userTurn] });

      const turnDone = new Promise<S2sTurn>((resolve, reject) => {
        resolveTurn = resolve;
        rejectCurrent = reject;
      });
      acc.markSent(Date.now());
      session.sendUserTurn(userText);
      const res = await withTimeout(turnDone, TURN_TIMEOUT_MS, `${what} turn`);

      totalMs += res.wallMs ?? 0;
      usage = addUsage(usage, res.usage);
      const agentTurn: TranscriptTurn = {
        role: "agent",
        text: res.text,
        ts: Date.now(),
        events: [],
        latencyMs: res.latencyMs,
      };
      history.push(userTurn, agentTurn);
      // onAudio precedes onUpdate on purpose: the surface reads the audio
      // cache during the render this patch triggers.
      if (res.audioChunks && onAudio) onAudio(agentTurn.ts, res.audioChunks);
      onUpdate({ turns: [...history], usage, totalMs });
    }
    onUpdate({ status: "done" });
  } catch (err) {
    // A stopped s2s cell reverts to idle with whatever completed; it will
    // rerun from scratch (no resume), so partial turns are display-only.
    if (err === ABORTED || signal?.aborted) {
      onUpdate({ status: "idle", turns: [...history], usage, totalMs });
    } else {
      onUpdate({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    closing = true;
    rejectCurrent = null;
    resolveTurn = null;
    try {
      session?.close();
    } catch {
      // already closed
    }
  }
}
