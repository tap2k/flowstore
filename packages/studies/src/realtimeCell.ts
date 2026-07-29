import type { ChatUsage } from "@flowstore/core/llm/types";
import {
  TurnAccumulator,
  runS2sCell,
  type RunS2sCellArgs,
  type S2sConnect,
  type S2sTurn,
} from "./s2sCell";

// OpenAI Realtime vendor half of the s2s cell: parser (Realtime event stream
// → TurnAccumulator) and transport (browser-direct WebSocket). The turn loop
// and CellState protocol live in s2sCell.
//
// Auth: the browser WebSocket API can't set an Authorization header, so the
// user's key rides the `openai-insecure-api-key.<key>` subprotocol — the
// documented browser-connect path. "Insecure" refers to embedding a key in a
// shipped web app; here it's the user's own key in their own browser, the
// same trust model as every other browser-direct call compare makes.
//
// Event names are handled in both their GA (response.output_audio.delta) and
// beta (response.audio.delta) spellings — the protocol renamed them and this
// parser has no reason to care which era the server speaks.

// Structural subset of Realtime server events — local so the parser (and its
// tests) never depend on an SDK.
export type RealtimeEvent = {
  type?: string;
  delta?: string;
  error?: { message?: string };
  response?: { usage?: RealtimeUsage };
};

export type RealtimeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
};

// Same discipline as the Live mapping: text details → inputTokens/
// outputTokens (text-only), audio details → audio fields, flat counts as the
// no-breakdown fallback so tokens are never silently dropped.
export function usageFromRealtimeUsage(u: RealtimeUsage): ChatUsage {
  const inD = u.input_token_details;
  const outD = u.output_token_details;
  return {
    inputTokens: inD ? (inD.text_tokens ?? 0) : (u.input_tokens ?? 0),
    outputTokens: outD ? (outD.text_tokens ?? 0) : (u.output_tokens ?? 0),
    ...(inD?.cached_tokens ? { cachedInputTokens: inD.cached_tokens } : {}),
    ...(inD?.audio_tokens ? { audioInputTokens: inD.audio_tokens } : {}),
    ...(outD?.audio_tokens ? { audioOutputTokens: outD.audio_tokens } : {}),
  };
}

const AUDIO_DELTAS = new Set(["response.output_audio.delta", "response.audio.delta"]);
const TEXT_DELTAS = new Set([
  "response.output_audio_transcript.delta",
  "response.audio_transcript.delta",
  "response.output_text.delta",
  "response.text.delta",
]);

// Parses the Realtime event stream into TurnAccumulator calls. One instance
// per session; feed() every parsed event.
export class RealtimeTurnCollector {
  private acc: TurnAccumulator;
  ready = false;

  constructor(onTurn: (turn: S2sTurn) => void) {
    this.acc = new TurnAccumulator(onTurn);
  }

  markSent(now: number): void {
    this.acc.markSent(now);
  }

  feed(evt: RealtimeEvent, now: number): void {
    const t = evt.type ?? "";
    if (t === "session.created") this.ready = true;
    else if (AUDIO_DELTAS.has(t)) this.acc.addAudio(evt.delta ?? "", now);
    else if (TEXT_DELTAS.has(t)) this.acc.addText(evt.delta ?? "", now);
    else if (t === "response.done") {
      if (evt.response?.usage) this.acc.setUsage(usageFromRealtimeUsage(evt.response.usage));
      this.acc.complete(now);
    }
  }
}

const REALTIME_URL = "wss://api.openai.com/v1/realtime";

const connectRealtime: S2sConnect = async ({
  dispatch,
  systemPrompt,
  onTurn,
  onReady,
  onFatal,
}) => {
  const collector = new RealtimeTurnCollector(onTurn);
  const ws = new WebSocket(
    `${REALTIME_URL}?model=${encodeURIComponent(dispatch.wireModel)}`,
    ["realtime", `openai-insecure-api-key.${dispatch.apiKey}`],
  );
  const send = (payload: unknown) => ws.send(JSON.stringify(payload));

  ws.onopen = () => {
    // Minimal session config: instructions + audio out. Formats are left at
    // the protocol default (pcm16 @ 24kHz — same as Gemini Live, so the
    // replay cache's WAV wrapper applies unchanged).
    send({
      type: "session.update",
      session: { type: "realtime", output_modalities: ["audio"], instructions: systemPrompt },
    });
  };
  ws.onmessage = (e: MessageEvent) => {
    let evt: RealtimeEvent;
    try {
      evt = JSON.parse(typeof e.data === "string" ? e.data : "") as RealtimeEvent;
    } catch {
      return;
    }
    // Fail loudly on protocol errors — a mis-shaped session.update or bad
    // model id should read as a crisp cell error, not a hang.
    if (evt.type === "error") {
      onFatal(new Error(evt.error?.message || "Realtime error."));
      return;
    }
    collector.feed(evt, Date.now());
    if (collector.ready) onReady();
  };
  ws.onerror = () => onFatal(new Error("Realtime socket error."));
  ws.onclose = () => onFatal(new Error("Realtime session closed unexpectedly."));

  return {
    sendUserTurn: (text: string) => {
      collector.markSent(Date.now());
      send({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
      });
      send({ type: "response.create" });
    },
    close: () => {
      ws.onclose = null;
      ws.close();
    },
  };
};

export function runRealtimeCell(args: RunS2sCellArgs): Promise<void> {
  return runS2sCell(args, connectRealtime, "Realtime");
}
