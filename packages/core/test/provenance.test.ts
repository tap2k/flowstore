import { describe, it, expect } from "vitest";
import { canonicalJson, specHash, promptHash, compileProvenance } from "@flowstore/core/spec/provenance";
import { generateSystemPrompt } from "@flowstore/core/codegen/promptGenerator";
import { loadFixtureSpec } from "./fixtures";
import type { Spec } from "@flowstore/core/schema/v0";

const fnol = loadFixtureSpec("fnol-min.json");

describe("compile provenance", () => {
  it("spec_hash is over the canonical normal form: key order and undefined do not matter", async () => {
    const reordered = Object.fromEntries(Object.keys(fnol).reverse().map((k) => [k, (fnol as unknown as Record<string, unknown>)[k]])) as unknown as Spec;
    const withUndefined = { ...fnol, flows: fnol.flows.map((f) => ({ ...f, __x: undefined })) } as unknown as Spec;
    const h = await specHash(fnol);
    expect(h).toHaveLength(16);
    expect(await specHash(reordered)).toBe(h);
    expect(await specHash(withUndefined)).toBe(h);
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });

  it("a content change changes spec_hash", async () => {
    const edited = { ...fnol, agent: { ...fnol.agent, purpose: (fnol.agent.purpose ?? "") + " (edited)" } } as Spec;
    expect(await specHash(edited)).not.toBe(await specHash(fnol));
  });

  it("prompt_hash follows the emitted text; provenance carries both", async () => {
    const text = generateSystemPrompt(fnol);
    const p = await compileProvenance(fnol, text, { compiler: "test", now: new Date(0) });
    expect(p.spec_hash).toBe(await specHash(fnol));
    expect(p.prompt_hash).toBe(await promptHash(text));
    expect(p.agent_id).toBe(fnol.agent.id);
    expect(p.compiled_at).toBe("1970-01-01T00:00:00.000Z");
    expect(await promptHash(text + " ")).not.toBe(p.prompt_hash);
  });
});
