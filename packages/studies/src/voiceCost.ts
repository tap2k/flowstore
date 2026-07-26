import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";

// Voice-cost estimate for a text-mode transcript: what this conversation
// would cost through a cascade stack (ASR + LLM + TTS) at the user's vendor
// rates. Discipline: keep measured and modeled apart. LLM dollars are
// measured (OpenRouter); TTS spend is measured usage (transcript characters)
// times their rate; the ONLY modeled quantity is speech time — words at
// ~150 wpm — which prices ASR and the $/min denominator. ASR is priced on
// caller speech time; duration-billed ASR vendors run higher.

export type VoiceRates = {
  // Speech-to-text, dollars per minute of caller audio.
  asrPerMin?: number;
  // Text-to-speech, dollars per million characters synthesized.
  ttsPerMChars?: number;
};

export type VoiceEstimate = {
  llmCost?: number; // measured (absent off-OpenRouter)
  ttsCost?: number; // agent chars × rate
  asrCost?: number; // modeled caller minutes × rate
  total: number; // sum of the parts that exist
  speechMinutes: number; // both sides, modeled at WPM
  perMinute?: number;
};

export const SPEECH_WPM = 150;

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

export function estimateVoiceCost(
  turns: TranscriptTurn[],
  llmCost: number | undefined,
  rates: VoiceRates,
): VoiceEstimate | null {
  const hasRates = rates.asrPerMin !== undefined || rates.ttsPerMChars !== undefined;
  if (!hasRates || turns.length === 0) return null;

  let agentChars = 0;
  let agentWords = 0;
  let userWords = 0;
  for (const t of turns) {
    if (t.role === "agent") {
      agentChars += t.text.length;
      agentWords += words(t.text);
    } else {
      userWords += words(t.text);
    }
  }

  const userMinutes = userWords / SPEECH_WPM;
  const speechMinutes = userMinutes + agentWords / SPEECH_WPM;
  const ttsCost =
    rates.ttsPerMChars !== undefined ? (agentChars / 1_000_000) * rates.ttsPerMChars : undefined;
  const asrCost = rates.asrPerMin !== undefined ? userMinutes * rates.asrPerMin : undefined;
  const total = (llmCost ?? 0) + (ttsCost ?? 0) + (asrCost ?? 0);
  return {
    llmCost,
    ttsCost,
    asrCost,
    total,
    speechMinutes,
    perMinute: speechMinutes > 0 ? total / speechMinutes : undefined,
  };
}
