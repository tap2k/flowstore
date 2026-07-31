import type { ChatUsage } from "@flowstore/core/llm/types";
import { runS2sCell, type RunS2sCellArgs, type S2sConnect, type TurnAccumulator } from "./s2sCell";

// Realtime-protocol half of the s2s cell: parser (event stream →
// TurnAccumulator) and transport (browser-direct WebSocket). The turn loop
// and CellState protocol live in s2sCell. Two vendors speak this protocol:
//
// OpenAI — the browser WebSocket API can't set an Authorization header, so
// the user's key rides the `openai-insecure-api-key.<key>` subprotocol
// ("insecure" refers to embedding a key in a shipped web app; here it's the
// user's own key in their own browser, the same trust model as every other
// browser-direct call compare makes).
//
// xAI (Grok Voice) — OpenAI-Realtime-compatible socket at api.x.ai. Browsers
// must present an EPHEMERAL client secret (`xai-client-secret.<token>`
// subprotocol); the mint endpoint allows browser CORS, so the token is
// minted here with the user's key and the path stays zero-backend.

// Structural subset of Realtime server events — local so the parser (and its
// tests) never depend on an SDK.
export type RealtimeEvent = {
  type?: string;
  delta?: string;
  error?: { message?: string };
  response?: {
    usage?: RealtimeUsage;
    // response.done carries the output items; when a vendor emits no
    // transcript deltas (xAI), the agent text is recovered from here.
    output?: { content?: { transcript?: string; text?: string }[] }[];
  };
};

export type RealtimeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
};

// Same discipline as the Live mapping: text details → inputTokens/
// outputTokens (text-only), audio details → audio fields. When a details
// object exists but omits text_tokens, derive it from the flat count so
// tokens are never silently dropped.
export function usageFromRealtimeUsage(u: RealtimeUsage): ChatUsage {
  const inD = u.input_token_details;
  const outD = u.output_token_details;
  const derive = (flat: number | undefined, audio: number | undefined, cached?: number) =>
    Math.max(0, (flat ?? 0) - (audio ?? 0) - (cached ?? 0));
  return {
    inputTokens: inD
      ? (inD.text_tokens ?? derive(u.input_tokens, inD.audio_tokens, inD.cached_tokens))
      : (u.input_tokens ?? 0),
    outputTokens: outD
      ? (outD.text_tokens ?? derive(u.output_tokens, outD.audio_tokens))
      : (u.output_tokens ?? 0),
    ...(inD?.cached_tokens ? { cachedInputTokens: inD.cached_tokens } : {}),
    ...(inD?.audio_tokens ? { audioInputTokens: inD.audio_tokens } : {}),
    ...(outD?.audio_tokens ? { audioOutputTokens: outD.audio_tokens } : {}),
  };
}

// GA and beta spellings both parse — the protocol renamed its delta events
// and project models may still route to beta-era hosts.
const AUDIO_DELTAS = new Set(["response.output_audio.delta", "response.audio.delta"]);
const TEXT_DELTAS = new Set([
  "response.output_audio_transcript.delta",
  "response.audio_transcript.delta",
]);

// Parses one session's Realtime events into accumulator calls. Stateful only
// for the transcript-delta bookkeeping (xAI fallback); feed() returns true
// when the event signals readiness — session.updated, i.e. our
// session.update has been ACKNOWLEDGED, not merely received.
export function makeRealtimeFeed(
  acc: TurnAccumulator,
): (evt: RealtimeEvent, now: number) => boolean {
  let sawTextDelta = false;
  return (evt, now) => {
    const t = evt.type ?? "";
    if (AUDIO_DELTAS.has(t)) acc.addAudio(evt.delta ?? "", now);
    else if (TEXT_DELTAS.has(t)) {
      sawTextDelta = true;
      acc.addText(evt.delta ?? "", now);
    } else if (t === "response.done") {
      if (evt.response?.usage) acc.setUsage(usageFromRealtimeUsage(evt.response.usage));
      // Vendors that emit no transcript deltas (xAI) put the agent text on
      // the response's output items — recover it so transcript grading and
      // divergence still work.
      if (!sawTextDelta) {
        const text = (evt.response?.output ?? [])
          .flatMap((o) => o.content ?? [])
          .map((c) => c.transcript ?? c.text ?? "")
          .join("");
        acc.addText(text, now);
      }
      sawTextDelta = false;
      acc.complete(now);
    }
    return t === "session.updated";
  };
}

// Back-compat shim for existing tests/callers: a fresh single-use feed.
export function feedRealtimeEvent(acc: TurnAccumulator, evt: RealtimeEvent, now: number): boolean {
  return makeRealtimeFeed(acc)(evt, now);
}

// Per-vendor connection facts. The protocol is shared; what differs is the
// socket URL, how the credential crosses the WebSocket boundary, and the
// session.update dialect.
type RealtimeVendor = {
  name: string;
  url: string;
  subprotocols: (apiKey: string) => Promise<string[]>;
  sessionUpdate: (systemPrompt: string, voice?: string) => unknown;
};

const VENDORS: Record<"openai" | "xai", RealtimeVendor> = {
  openai: {
    name: "Realtime",
    url: "wss://api.openai.com/v1/realtime",
    subprotocols: (apiKey) => Promise.resolve(["realtime", `openai-insecure-api-key.${apiKey}`]),
    // Minimal session config: instructions + audio out. Formats stay at the
    // protocol default (pcm16 @ 24kHz — the replay cache's wire format).
    sessionUpdate: (systemPrompt, voice) => ({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions: systemPrompt,
        ...(voice ? { audio: { output: { voice } } } : {}),
      },
    }),
  },
  xai: {
    name: "Grok Voice",
    url: "wss://api.x.ai/v1/realtime",
    // Browsers must present an ephemeral client secret; mint it with the
    // user's key (the endpoint allows browser CORS — verified 2026-07).
    subprotocols: async (apiKey) => {
      const res = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ expires_after: { seconds: 300 } }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        value?: string;
        client_secret?: { value?: string };
        error?: { message?: string };
        msg?: string;
      };
      if (!res.ok) {
        throw new Error(body.error?.message || body.msg || `Grok token mint failed (${res.status}).`);
      }
      const token = body.value ?? body.client_secret?.value;
      if (!token) throw new Error("Grok token mint returned no client secret.");
      return [`xai-client-secret.${token}`];
    },
    // xAI's session dialect: no `type` field; audio format set explicitly to
    // the cache's wire format (their default may differ).
    sessionUpdate: (systemPrompt, voice) => ({
      type: "session.update",
      session: {
        instructions: systemPrompt,
        audio: { output: { format: { type: "audio/pcm", rate: 24000 } } },
        ...(voice ? { voice } : {}),
      },
    }),
  },
};

// Socket-level connection facts, exported for the browser's INTERACTIVE
// Realtime voice session (simulate) — same URL and credential transit as the
// compare cells; the session dialect differs there (mic input, VAD, tools).
export function realtimeSocketInfo(provider: "openai" | "xai"): {
  name: string;
  url: string;
  subprotocols: (apiKey: string) => Promise<string[]>;
} {
  const v = VENDORS[provider];
  return { name: v.name, url: v.url, subprotocols: v.subprotocols };
}

function connectVendor(vendor: RealtimeVendor): S2sConnect {
  return async ({ dispatch, systemPrompt, acc, onReady, onFatal }) => {
    const protocols = await vendor.subprotocols(dispatch.apiKey);
    const ws = new WebSocket(
      `${vendor.url}?model=${encodeURIComponent(dispatch.wireModel)}`,
      protocols,
    );
    const send = (payload: unknown) => ws.send(JSON.stringify(payload));
    const feed = makeRealtimeFeed(acc);
    let readySent = false;

    ws.onopen = () => {
      send(vendor.sessionUpdate(systemPrompt, dispatch.voice));
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
        onFatal(new Error(evt.error?.message || `${vendor.name} error.`));
        return;
      }
      if (feed(evt, Date.now()) && !readySent) {
        readySent = true;
        onReady();
      }
    };
    ws.onerror = () => onFatal(new Error(`${vendor.name} socket error.`));
    // Intentional close is a no-op at the skeleton (closing latch) — report
    // every close and let it decide.
    ws.onclose = () => onFatal(new Error(`${vendor.name} session closed unexpectedly.`));

    return {
      sendUserTurn: (text: string) => {
        send({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
        });
        send({ type: "response.create" });
      },
      close: () => ws.close(),
    };
  };
}

export function runRealtimeCell(args: RunS2sCellArgs): Promise<void> {
  return runS2sCell(args, connectVendor(VENDORS.openai), "Realtime");
}

export function runGrokVoiceCell(args: RunS2sCellArgs): Promise<void> {
  return runS2sCell(args, connectVendor(VENDORS.xai), "Grok Voice");
}
