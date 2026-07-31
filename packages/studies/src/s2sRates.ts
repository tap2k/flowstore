import type { ChatUsage } from "@flowstore/core/llm/types";

// Local rate table for s2s columns. The live APIs report tokens but never
// dollars, so s2s cost is ESTIMATED — measured tokens × published rates —
// and every surface labels it "~" to keep measured and modeled apart (same
// discipline as voiceCost's cascade estimate).
//
// Extensible by adding a row: first regex match against the model id wins,
// so keep narrower patterns (mini variants) above their parents. Rates are
// $/1M tokens, published pricing as of 2026-07; update as vendors move.
export type S2sRates =
  // Token-priced vendors ($/1M tokens by modality)…
  | {
      textInPerM: number;
      textOutPerM: number;
      audioInPerM: number;
      audioOutPerM: number;
    }
  // …or wall-time-priced vendors ($/minute of session — Grok Voice).
  | { perMinute: number };

const RATE_TABLE: { match: RegExp; rates: S2sRates }[] = [
  // Gemini Live (half-cascade and native-audio flavors share pricing)
  {
    match: /gemini.*(live|native-audio)/i,
    rates: { textInPerM: 0.5, textOutPerM: 2.0, audioInPerM: 3.0, audioOutPerM: 12.0 },
  },
  // OpenAI Realtime — mini before full (first match wins)
  {
    match: /gpt-realtime-mini|gpt-4o-mini-realtime/i,
    rates: { textInPerM: 0.6, textOutPerM: 2.4, audioInPerM: 10.0, audioOutPerM: 20.0 },
  },
  {
    match: /gpt-realtime|gpt-4o-realtime/i,
    rates: { textInPerM: 4.0, textOutPerM: 16.0, audioInPerM: 32.0, audioOutPerM: 64.0 },
  },
  // Grok Voice bills per minute; the estimate uses the cell's measured wall
  // time (turn send→complete — what the socket actually held).
  { match: /grok-voice/i, rates: { perMinute: 0.05 } },
];

export function s2sRatesFor(model: string): S2sRates | null {
  return RATE_TABLE.find((r) => r.match.test(model))?.rates ?? null;
}

// Estimated dollars for an s2s cell: token-priced vendors need audio tokens
// in the usage (text columns keep the measured-or-nothing discipline);
// wall-priced vendors need the cell's wall time. Null when the model has no
// rate row or the required measurement is absent.
export function estimateS2sCost(
  usage: ChatUsage | undefined,
  model: string,
  wallMs?: number,
): number | null {
  const r = s2sRatesFor(model);
  if (!r) return null;
  if ("perMinute" in r) {
    return wallMs && wallMs > 0 ? (wallMs / 60_000) * r.perMinute : null;
  }
  if (!usage) return null;
  if (!usage.audioInputTokens && !usage.audioOutputTokens) return null;
  return (
    (usage.inputTokens / 1e6) * r.textInPerM +
    (usage.outputTokens / 1e6) * r.textOutPerM +
    ((usage.audioInputTokens ?? 0) / 1e6) * r.audioInPerM +
    ((usage.audioOutputTokens ?? 0) / 1e6) * r.audioOutPerM
  );
}
