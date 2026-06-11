// Browser-side "voice-realistic text" shaping for simulated user turns. Tracks
// the Python harness's asr_shape (awaaz-dpd31/scripts/_persona.py): same
// de-punctuation regex, filler lists, level semantics, probabilities, and draw
// order. SEEDED and deterministic — keyed on (seed, text) via the same FNV-1a
// hash the Python side uses — so a given turn shapes reproducibly; vary the seed
// to get variance. The only thing not shared with Python is the PRNG itself
// (Python uses CPython's Mersenne Twister, here a portable mulberry32), so the
// outputs are semantically identical but not byte-identical. To make them
// byte-identical, both sides would adopt this same portable PRNG. Barge-in
// truncation is harness-only (omitted here).

export type AsrLevel = "off" | "clean" | "light" | "heavy";

// Keyed by language (falls back to EN). Mirrors _FILLERS in _persona.py.
const FILLERS: Record<string, string[]> = {
  ES: ["este", "o sea", "mmm", "eh", "pues", "bueno"],
  EN: ["um", "uh", "like", "you know", "er", "well"],
};

// Punctuation an ASR transcript typically does not emit. Apostrophes and
// intra-word hyphens are left alone; sentence punctuation, Spanish opening
// marks, and em-dash are stripped. Mirrors _PUNCT_RE in _persona.py.
const PUNCT = /[.,;:!?¡¿"“”…()]+|(?<!\w)-|-(?!\w)|—/g;

// FNV-1a over `${seed}|${text}` → a portable mulberry32 PRNG. Mirrors _rng() in
// _persona.py (same hash; different PRNG body — see the module header).
function rng(seed: number, text: string): () => number {
  let h = 2166136261;
  const key = `${seed}|${text}`;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randint = (r: () => number, lo: number, hi: number) =>
  lo + Math.floor(r() * (hi - lo + 1)); // inclusive, like random.randint

export function asrShape(
  text: string,
  level: AsrLevel,
  lang = "EN",
  seed = 0,
): string {
  if (level === "off" || !text) return text;
  const out = text.replace(PUNCT, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (level === "clean" || !out) return out;
  const r = rng(seed, text);
  const fillers = FILLERS[(lang || "EN").toUpperCase()] ?? FILLERS.EN;
  const words = out.split(" ");
  // an occasional filler at a random position
  if (words.length && r() < 0.5) {
    words.splice(randint(r, 0, words.length), 0, fillers[randint(r, 0, fillers.length - 1)]);
  }
  // heavy: a single mid-utterance false start (re-utter the first word or two)
  if (level === "heavy" && words.length >= 3 && r() < 0.4) {
    const k = randint(r, 1, 2);
    words.unshift(...words.slice(0, k));
  }
  return words.join(" ");
}

// Barge-in: with `propensity` (0–1), the caller cuts the agent off — returns the
// prefix they "heard" (a 30–70% word-prefix + an ellipsis cue), or null if no
// barge-in this turn. Seeded: first draw decides, second draw sets the cut.
// Mirrors barge_in_prefix in _persona.py (the "…" and the propensity gate are
// browser-side). The caller trims the agent's prior turn to this before the
// persona responds, so the persona reacts to half a reply and the agent's next
// turn sees it was cut off. Text/prompt mode only (runner holds history
// server-side, so a transcript trim wouldn't reach the agent).
export function maybeBargeIn(
  reply: string,
  seed: number,
  propensity: number,
): string | null {
  const words = (reply ?? "").split(/\s+/).filter(Boolean);
  if (words.length <= 1 || propensity <= 0) return null;
  const r = rng(seed, reply);
  if (r() >= propensity) return null;
  const cut = Math.max(1, Math.floor(words.length * (0.3 + r() * 0.4)));
  return words.slice(0, cut).join(" ") + "…";
}
