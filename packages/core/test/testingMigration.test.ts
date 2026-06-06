import { describe, it, expect } from "vitest";
import { loadTestingArtifacts } from "@flowstore/core/files/testing";
import type { FileMap, LoadError } from "@flowstore/core/files/types";

// Migration-on-load: legacy "persona owns the world" → "persona = actor with
// intrinsic fixture; case carries situational fixture". Behavior-preserving
// (effective fixture `persona ∪ case` unchanged) and idempotent (re-running on
// new-model artifacts is a no-op).

function persona(id: string, body: Record<string, unknown>): [string, string] {
  return [`tests/personas/${id}.persona.json`, JSON.stringify({ $schema: "flowstore://test/persona/v0", id, ...body })];
}
function testCase(id: string, body: Record<string, unknown>): [string, string] {
  return [`tests/cases/${id}.test.json`, JSON.stringify({ $schema: "flowstore://test/case/v0", id, ...body })];
}
function load(files: FileMap) {
  const errors: LoadError[] = [];
  const artifacts = loadTestingArtifacts(files, errors);
  return { artifacts, errors };
}

describe("testing migration-on-load", () => {
  it("folds a world-only persona's fixture into its scripted case and deletes the persona", () => {
    const files: FileMap = Object.fromEntries([
      persona("known-caller", { vars: { caller_name: "Casey Lin" }, mocks: { cap_verify: { kind: "static", returns: { active: true } } } }),
      testCase("happy", { user_turns: ["hi"], persona_id: "known-caller" }),
    ]);
    const { artifacts, errors } = load(files);
    expect(errors).toEqual([]);
    expect(artifacts.personas).toHaveLength(0); // world-only persona deleted
    const c = artifacts.testCases[0];
    expect(c.persona_id).toBeUndefined(); // binding dropped
    expect(c.vars).toEqual({ caller_name: "Casey Lin" });
    expect(c.mocks).toEqual({ cap_verify: { kind: "static", returns: { active: true } } });
  });

  it("case fixture wins over the persona's on key collisions", () => {
    const files: FileMap = Object.fromEntries([
      persona("known", { vars: { caller_name: "Persona Name", policy: "P1" } }),
      testCase("c", { user_turns: ["hi"], persona_id: "known", vars: { caller_name: "Case Name" } }),
    ]);
    const c = load(files).artifacts.testCases[0];
    expect(c.vars).toEqual({ caller_name: "Case Name", policy: "P1" });
  });

  it("folds a prompted persona's fixture into a scripted case but keeps the persona as an actor", () => {
    const files: FileMap = Object.fromEntries([
      persona("panicking", { system_prompt: "You are panicking.", vars: { caller_name: "Jordan" } }),
      testCase("scripted-c", { user_turns: ["help"], persona_id: "panicking" }),
    ]);
    const { artifacts } = load(files);
    expect(artifacts.personas).toHaveLength(1); // prompted persona survives
    const p = artifacts.personas[0];
    expect(p.vars).toEqual({ caller_name: "Jordan" }); // intrinsic fixture retained
    const c = artifacts.testCases[0];
    expect(c.persona_id).toBeUndefined(); // scripted case detached
    expect(c.vars).toEqual({ caller_name: "Jordan" }); // folded in (behavior-preserving)
  });

  it("leaves a persona-driven case bound to a prompted persona untouched", () => {
    const files: FileMap = Object.fromEntries([
      persona("driver", { system_prompt: "You are a driver.", vars: { caller_name: "Sam" } }),
      testCase("pd", { persona_id: "driver" }),
    ]);
    const { artifacts } = load(files);
    expect(artifacts.personas).toHaveLength(1);
    const c = artifacts.testCases[0];
    expect(c.persona_id).toBe("driver"); // binding preserved
    expect(c.vars).toBeUndefined(); // no fold — inherits via persona ∪ case at run time
  });

  it("rejects (does not silently delete) a present-but-empty system_prompt", () => {
    // Absent system_prompt = legacy world-only -> migrated away. Present-but-
    // empty = new-model authoring mistake -> reaches the schema and fails loudly.
    const files: FileMap = Object.fromEntries([
      persona("blank", { system_prompt: "", vars: { caller_name: "X" } }),
      testCase("c", { user_turns: ["hi"] }),
    ]);
    const { artifacts, errors } = load(files);
    expect(errors.some((e) => e.path?.includes("blank"))).toBe(true);
    expect(artifacts.personas.find((p) => p.id === "blank")).toBeUndefined();
  });

  it("is idempotent — new-model artifacts pass through unchanged", () => {
    const files: FileMap = Object.fromEntries([
      persona("actor", { system_prompt: "You are an actor.", vars: { caller_name: "Sam" } }),
      testCase("scripted", { user_turns: ["hi"], vars: { foo: "bar" } }),
      testCase("driven", { persona_id: "actor" }),
    ]);
    const { artifacts, errors } = load(files);
    expect(errors).toEqual([]);
    expect(artifacts.personas).toHaveLength(1);
    expect(artifacts.testCases.find((c) => c.id === "scripted")?.vars).toEqual({ foo: "bar" });
    expect(artifacts.testCases.find((c) => c.id === "driven")?.persona_id).toBe("actor");
  });
});
