// Browser-side "voice-realistic text" shaping for simulated user turns. The
// interactive sim is exploratory and already non-deterministic (the persona is
// an LLM), so this is intentionally NON-seeded — Math.random per turn. The
// Python regression harness has its own SEEDED version (asr_shape /
// maybe_barge_in in _persona.py) where reproducibility is load-bearing. Same
// idea (de-punctuate, occasional filler/false-start, barge-in trim), different
// surface; they do not — and need not — match.

export type AsrLevel = "off" | "clean" | "light" | "heavy";

// Keyed by language (falls back to EN).
const FILLERS: Record<string, string[]> = {
  ES: ["este", "o sea", "mmm", "eh", "pues", "bueno"],
  EN: ["um", "uh", "like", "you know", "er", "well"],
};

// Punctuation an ASR transcript typically does not emit. Apostrophes and
// intra-word hyphens are left alone; sentence punctuation, Spanish opening
// marks, and em-dash are stripped.
const PUNCT = /[.,;:!?¡¿"“”…()]+|(?<!\w)-|-(?!\w)|—/g;

export function asrShape(text: string, level: AsrLevel, lang = "EN"): string {
  if (level === "off" || !text) return text;
  const out = text.replace(PUNCT, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (level === "clean" || !out) return out;
  const fillers = FILLERS[(lang || "EN").toUpperCase()] ?? FILLERS.EN;
  const words = out.split(" ");
  // an occasional filler at a random position
  if (words.length && Math.random() < 0.5) {
    const at = Math.floor(Math.random() * (words.length + 1));
    words.splice(at, 0, fillers[Math.floor(Math.random() * fillers.length)]);
  }
  // heavy: a single mid-utterance false start (re-utter the first word or two)
  if (level === "heavy" && words.length >= 3 && Math.random() < 0.4) {
    const k = 1 + Math.floor(Math.random() * 2);
    words.unshift(...words.slice(0, k));
  }
  return words.join(" ");
}

// Barge-in: with `propensity` (0–1), the caller cuts the agent off — returns the
// prefix they "heard" (a 30–70% word-prefix), or null if no barge-in this turn.
// The caller trims the agent's prior turn to this before the persona responds,
// so the persona reacts to half a reply and the agent's next turn sees it was
// cut off. A "was interrupted" cue belongs on turn metadata, not in the text.
export function maybeBargeIn(reply: string, propensity: number): string | null {
  const words = (reply ?? "").split(/\s+/).filter(Boolean);
  if (words.length <= 1 || propensity <= 0) return null;
  if (Math.random() >= propensity) return null;
  const cut = Math.max(1, Math.floor(words.length * (0.3 + Math.random() * 0.4)));
  return words.slice(0, cut).join(" ");
}
