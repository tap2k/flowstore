import type { ChatUsage } from "@flowstore/core/llm/types";

// Local rate table for s2s (Gemini Live) columns. Google reports tokens but
// never dollars, so live cost is ESTIMATED — measured tokens × published
// rates — and every surface labels it "~" to keep measured and modeled
// apart (same discipline as voiceCost's cascade estimate). Rates are $/1M
// tokens, Gemini Live preview pricing as of 2026-07; update as Google moves.
export type LiveRates = {
  textInPerM: number;
  textOutPerM: number;
  audioInPerM: number;
  audioOutPerM: number;
};

const GEMINI_LIVE_RATES: LiveRates = {
  textInPerM: 0.5,
  textOutPerM: 2.0,
  audioInPerM: 3.0,
  audioOutPerM: 12.0,
};

export function liveRatesFor(wireModel: string): LiveRates | null {
  return /live|native-audio/i.test(wireModel) ? GEMINI_LIVE_RATES : null;
}

// Estimated dollars for a live cell's aggregate usage; null when the model
// has no rate entry or the usage carries no audio tokens (i.e. not a live
// run — text columns keep their measured-or-nothing cost discipline).
export function estimateLiveCost(usage: ChatUsage | undefined, wireModel: string): number | null {
  if (!usage) return null;
  if (!usage.audioInputTokens && !usage.audioOutputTokens) return null;
  const r = liveRatesFor(wireModel);
  if (!r) return null;
  return (
    (usage.inputTokens / 1e6) * r.textInPerM +
    (usage.outputTokens / 1e6) * r.textOutPerM +
    ((usage.audioInputTokens ?? 0) / 1e6) * r.audioInPerM +
    ((usage.audioOutputTokens ?? 0) / 1e6) * r.audioOutPerM
  );
}
