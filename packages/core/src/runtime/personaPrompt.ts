import type { Modality } from "@flowstore/core/schema/v0";

// ─────────────────────────────────────────────────────────────────────────────
// User-sim prompt renderer: (identity + scenario, modality) → one runnable
// system prompt. Everything that drives a persona composes through here.
//
// REFERENCE + HAND-MIRROR (not a single source). The Python harness keeps a
// hand-maintained, byte-for-byte mirror at scripts/_persona.py in each example
// agent repo, so the interactive sim and the batch
// regression harness produce identical persona prompts — otherwise "what the sim
// shows" stops predicting "what the suite scores". The goldens (this repo's
// packages/core/test/personaRail.test.ts and the Python self-check) CATCH drift;
// they don't prevent it, so if you change anything here (rail wording, ordering,
// spacing) update the mirror AND both goldens in the same change. The proper
// single-source fix (a `flowstore-compile --format persona` boundary) is
// deferred until a second consumer forces it — see planning/persona-simulation.md.
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
// this core renderer: Python-side in the example repos' scripts/_persona.py
// (seeded, regression-exact), and for the browser sim in
// packages/browser/src/lib/runtime/asrShape.ts (a seeded portable-PRNG version).
export function defaultPersonaInstructions(modality: Modality): string {
  const lengthRule =
    modality === "text"
      ? "- You're texting: keep each message to a line or two — short and casual, never paragraphs or bullet points."
      : "- You're on a call: one short, spoken-sounding sentence per turn — no lists, no markdown, no spelling things out. Contractions and the odd filler are fine.";
  return [
    "How to play this part:",
    "- CRITICAL: You are the user (as described below), not the agent. Only ever send the user's own messages from the perspective of the user — never write the agent's lines, answer your own questions, narrate, or emit tags or tool calls. You must always play the part assigned to you below.",
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
