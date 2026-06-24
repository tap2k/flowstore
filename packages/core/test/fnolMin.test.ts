import { describe, it, expect } from "vitest";
import { compileSystemPrompt } from "@flowstore/core/codegen/promptGenerator";
import { decomposeSpec, loadProject } from "@flowstore/core/files";
import { validateSpec } from "@flowstore/core/validation/ajv";
import { validateGraph } from "@flowstore/core/validation/graphRules";
import { loadFixtureSpec, normalize, sortById } from "./fixtures";

const fnol = loadFixtureSpec("fnol-min.json");

describe("fnol-min fixture — sanity", () => {
  it("is schema-valid", () => {
    expect(validateSpec(fnol).valid).toBe(true);
  });

  it("has a clean graph", () => {
    expect(validateGraph(fnol)).toEqual([]);
  });

  it("round-trips losslessly through decompose ↔ load", () => {
    const { spec: resolved, errors } = loadProject(decomposeSpec(fnol));
    expect(errors).toEqual([]);
    expect(normalize(sortById(resolved!))).toEqual(normalize(sortById(fnol)));
  });

  it("exercises interrupts + RETURN", () => {
    const interrupt = fnol.flows.find((f) => f.type === "interrupt")!;
    expect(interrupt.exit_paths.some((xp) => xp.goto === "RETURN")).toBe(true);
  });
});

describe("fnol-min fixture — multilingual codegen", () => {
  it("renders the default language (en-US) script text", () => {
    const text = compileSystemPrompt(fnol).text;
    expect(text).toContain("What's your policy number?");
    expect(text).not.toContain("¿Cuál es su número de póliza?");
  });

  it("renders the es-MX script text when that language is selected", () => {
    const text = compileSystemPrompt(fnol, undefined, { language: "es-MX" }).text;
    expect(text).toContain("¿Cuál es su número de póliza?");
    expect(text).not.toContain("What's your policy number?");
  });
});

describe("fnol-min fixture — visible_when + placeholder", () => {
  it("declares a visible_when-gated variable", () => {
    expect(fnol.agent.variables!.payout_estimate.visible_when).toBe("identity_verified == True");
  });

  it("leaves {{payout_estimate}} literal when no vars are bound", () => {
    expect(compileSystemPrompt(fnol).text).toContain("{{payout_estimate}}");
  });

  it("substitutes the placeholder when the variable is bound", () => {
    const text = compileSystemPrompt(fnol, { payout_estimate: "$4,200" }).text;
    expect(text).toContain("Your estimated payout is $4,200.");
    expect(text).not.toContain("{{payout_estimate}}");
  });
});
