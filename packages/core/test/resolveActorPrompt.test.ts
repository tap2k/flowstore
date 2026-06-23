import { describe, it, expect } from "vitest";
import { resolveActorPrompt } from "@flowstore/core/runtime/personaRuntime";

describe("resolveActorPrompt", () => {
  it("returns the persona prompt when the case has no inline overlay", () => {
    expect(resolveActorPrompt({ system_prompt: "You are Maria." }, {})).toBe("You are Maria.");
  });

  it("returns the inline prompt when there is no bound persona", () => {
    expect(resolveActorPrompt(undefined, { system_prompt: "You are a hurried customer." })).toBe(
      "You are a hurried customer.",
    );
  });

  it("appends the case overlay after the persona base when both are present", () => {
    expect(
      resolveActorPrompt({ system_prompt: "You are Maria." }, { system_prompt: "Today you're furious." }),
    ).toBe("You are Maria.\n\nToday you're furious.");
  });

  it("trims each part and resolves to '' for a scripted case (no prompts)", () => {
    expect(resolveActorPrompt({ system_prompt: "  You are Maria.  " }, { system_prompt: "  " })).toBe(
      "You are Maria.",
    );
    expect(resolveActorPrompt(undefined, {})).toBe("");
  });
});
