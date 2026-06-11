import { describe, it, expect } from "vitest";
import {
  defaultPersonaInstructions,
  composePersonaPrompt,
} from "@flowstore/core/runtime/personaPrompt";

// Conformance fixture for the user-sim prompt renderer. These are the strings
// that any harness driving a persona (the browser sim, the Python harness at
// awaaz-dpd31/scripts/_persona.py) must keep byte-for-byte in sync — see
// planning/persona-simulation.md. Snapshotting them here means an edit is a
// deliberate, visible change, and the mirror has a golden to match against. If
// you change the rail or the compose shape, update the harness copies AND the
// awaaz golden in the same change.
describe("defaultPersonaInstructions — rail conformance", () => {
  it("voice", () => {
    expect(defaultPersonaInstructions("voice")).toMatchInlineSnapshot(`
      "How to play this part:
      - You are the user, not the agent. Only ever send the user's own messages — never write the agent's lines, answer your own questions, narrate, or emit tags or tool calls.
      - Stay in character. Never say you're an AI, a model, or a test; never break the fourth wall.
      - Reply in whatever language the agent is using.
      - You're on a call: one short, spoken-sounding sentence per turn — no lists, no markdown, no spelling things out. Contractions and the odd filler are fine.
      - If a message is empty or unclear, react as a real person would ("Hello?", "Sorry, what?").
      - Put [DONE] on its own line once the conversation has wrapped up — after any final thanks or goodbye — or if you give up."
    `);
  });

  it("text", () => {
    expect(defaultPersonaInstructions("text")).toMatchInlineSnapshot(`
      "How to play this part:
      - You are the user, not the agent. Only ever send the user's own messages — never write the agent's lines, answer your own questions, narrate, or emit tags or tool calls.
      - Stay in character. Never say you're an AI, a model, or a test; never break the fourth wall.
      - Reply in whatever language the agent is using.
      - You're texting: keep each message to a line or two — short and casual, never paragraphs or bullet points.
      - If a message is empty or unclear, react as a real person would ("Hello?", "Sorry, what?").
      - Put [DONE] on its own line once the conversation has wrapped up — after any final thanks or goodbye — or if you give up."
    `);
  });

  // multimodal falls to the spoken/call form (conservative: works spoken or typed).
  it("multimodal uses the call form", () => {
    expect(defaultPersonaInstructions("multimodal")).toBe(
      defaultPersonaInstructions("voice"),
    );
  });
});

// compose = trimmed identity + rail. Traits never enter the prompt. The rail
// (the only non-trivial part, and the cross-repo contract with the Python
// mirror) is pinned per modality above, so these just check the trivial wrapper.
describe("composePersonaPrompt — wrapper", () => {
  it("voice: trimmed identity + rail (no traits inlined)", () => {
    expect(
      composePersonaPrompt({ personaPrompt: "  You are Ana.  ", modality: "voice" }),
    ).toBe(`You are Ana.\n\n${defaultPersonaInstructions("voice")}`);
  });

  it("text modality rail", () => {
    expect(
      composePersonaPrompt({ personaPrompt: "You are Ana.", modality: "text" }),
    ).toBe(`You are Ana.\n\n${defaultPersonaInstructions("text")}`);
  });
});
