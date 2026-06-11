import { describe, it, expect } from "vitest";
import { defaultPersonaInstructions } from "@flowstore/core/runtime/personaClient";

// Conformance fixture for the user-sim rail. This is the single string per
// modality that any harness driving a persona (the browser sim, the Python
// harness) must keep in sync — see docs/persona-simulation.md. Snapshotting it
// here means an edit is a deliberate, visible change, and the awaaz-side copy
// has a golden to match against. If you change the rail, update the harness
// copies in the same change.
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
