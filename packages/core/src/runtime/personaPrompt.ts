import type { Modality } from "@flowstore/core/schema/v0";

// ─────────────────────────────────────────────────────────────────────────────
// THE canonical user-sim prompt renderer.
//
// composePersonaPrompt() is the single source of truth for how a persona
// becomes a runnable system prompt: (identity + scenario, traits, modality) → one
// string. Everything that drives a persona composes through here.
//
// CROSS-REPO SYNC CONTRACT. The Python harness keeps a byte-for-byte mirror at
// awaaz-dpd31/scripts/_persona.py, because the interactive sim (this code) and
// the batch regression harness (Python) must produce identical persona prompts —
// otherwise "what the sim shows" stops predicting "what the suite scores". If you
// change anything here (rail wording, traits format, ordering, spacing), update
// that mirror AND the golden snapshots in BOTH repos in the same change. The
// golden lives at packages/core/test/personaRail.test.ts.
//
// Layering, the deferred trait-specific rail switches, and the rationale for a
// single non-parametrized rail: planning/persona-simulation.md.
// ─────────────────────────────────────────────────────────────────────────────

// Default behavioral instructions for an LLM roleplaying the USER side of a
// simulated conversation. Applied at run time, NOT baked into the persona, so
// the persona file stays declarative — pure identity + scenario — and these
// generic, medium-aware rules stay a runtime concern: flip the agent's modality
// and every persona re-tunes on the next turn, with no stored frame to go stale.
//
// A SINGLE non-parametrized string per modality (mode-invariant rules + one
// length/format rule). It shapes what the persona GENERATES. Mechanical channel
// perturbation — ASR de-punctuation, fillers, barge-in truncation — is a
// separate transport layer that mutates the produced text deterministically. It
// is NOT mirrored here: its determinism is bound to CPython's seeded RNG (a TS
// port can't reproduce it byte-for-byte), and only the Python regression path
// needs it. The browser sim and that regression harness are different test
// modalities, so minor deviance is fine. It lives where it's consumed, not in
// this core renderer: Python-side in awaaz-dpd31/scripts/_persona.py (seeded,
// regression-exact), and for the browser sim in
// packages/browser/src/lib/runtime/asrShape.ts (a seeded portable-PRNG version).
export function defaultPersonaInstructions(modality: Modality): string {
  const lengthRule =
    modality === "text"
      ? "- You're texting: keep each message to a line or two — short and casual, never paragraphs or bullet points."
      : "- You're on a call: one short, spoken-sounding sentence per turn — no lists, no markdown, no spelling things out. Contractions and the odd filler are fine.";
  return [
    "How to play this part:",
    "- You are the user, not the agent. Only ever send the user's own messages — never write the agent's lines, answer your own questions, narrate, or emit tags or tool calls.",
    "- Stay in character. Never say you're an AI, a model, or a test; never break the fourth wall.",
    "- Reply in whatever language the agent is using.",
    lengthRule,
    '- If a message is empty or unclear, react as a real person would ("Hello?", "Sorry, what?").',
    "- Put [DONE] on its own line once the conversation has wrapped up — after any final thanks or goodbye — or if you give up.",
  ].join("\n");
}

// Compose the runnable user-sim system prompt: identity + scenario · medium
// rail. The one function to mirror across harnesses. Traits are deliberately NOT
// inlined — they're open structured knobs (consumed mechanically, e.g. asr /
// barge_in, or read for analysis), and pasting arbitrary `key: value` lines into
// the prompt has dubious value and risks the persona acting them out.
export function composePersonaPrompt(opts: {
  personaPrompt: string;
  modality: Modality;
}): string {
  return `${opts.personaPrompt.trim()}\n\n${defaultPersonaInstructions(opts.modality)}`;
}
