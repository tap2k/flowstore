import type { ChatUsage } from "@flowstore/core/llm/types";

// Local rate table for s2s columns. The live APIs report tokens but never
// dollars, so s2s cost is ESTIMATED — measured tokens × published rates —
// and every surface labels it "~" to keep measured and modeled apart (same
// discipline as voiceCost's cascade estimate).
//
// Extensible by adding a row: first regex match against the model id wins,
// so keep narrower patterns (mini variants) above their parents. Rates are
// $/1M tokens, published pricing as of 2026-07; update as vendors move.
export type LiveRates = {
  textInPerM: number;
  textOutPerM: number;
  audioInPerM: number;
  audioOutPerM: number;
};

const RATE_TABLE: { match: RegExp; rates: LiveRates }[] = [
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
];

export function liveRatesFor(model: string): LiveRates | null {
  return RATE_TABLE.find((r) => r.match.test(model))?.rates ?? null;
}

// Estimated dollars for an s2s cell's aggregate usage; null when the model
// has no rate entry or the usage carries no audio tokens (i.e. not a live
// run — text columns keep their measured-or-nothing cost discipline).
export function estimateLiveCost(usage: ChatUsage | undefined, model: string): number | null {
  if (!usage) return null;
  if (!usage.audioInputTokens && !usage.audioOutputTokens) return null;
  const r = liveRatesFor(model);
  if (!r) return null;
  return (
    (usage.inputTokens / 1e6) * r.textInPerM +
    (usage.outputTokens / 1e6) * r.textOutPerM +
    ((usage.audioInputTokens ?? 0) / 1e6) * r.audioInPerM +
    ((usage.audioOutputTokens ?? 0) / 1e6) * r.audioOutPerM
  );
}
