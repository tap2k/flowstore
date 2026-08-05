import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// createScopedJsonStorage no-ops without a window — give the node env a
// minimal localStorage so load/save round-trips exercise the validator.
const backing = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  },
});

import { EMPTY_STUDY, freshStudy, loadStudy, saveStudy } from "./studyStorage";

const KEY = "flowstore:compare:study:current";

beforeEach(() => backing.clear());
afterEach(() => backing.clear());

const u = (text: string) => ({ role: "user" as const, text });
const a = (text: string) => ({ role: "agent" as const, text });

const study = () => ({
  ...EMPTY_STUDY,
  agentId: "agent-test",
  prompt: "You are Asha.",
  scenarios: [{ id: "s1", scenarioId: "s1", name: "S1", language: "EN", turns: [u("hi")] }],
  models: ["m0", "m1"],
});

describe("studyStorage", () => {
  it("round-trips a study", () => {
    saveStudy(study());
    expect(loadStudy()).toEqual(study());
  });

  it("rehydrates mid-run cells as idle — a reload can't resume a run", () => {
    saveStudy({
      ...study(),
      cells: {
        "s1::0": { status: "running", turns: [], totalMs: 0 },
        "s1::1": { status: "done", turns: [], totalMs: 5 },
      },
    });
    const loaded = loadStudy();
    expect(loaded.cells["s1::0"].status).toBe("idle");
    expect(loaded.cells["s1::1"].status).toBe("done");
  });

  it("saving an empty study removes the key instead of storing junk", () => {
    saveStudy(study());
    expect(backing.has(KEY)).toBe(true);
    // agentId doesn't make a study persistence-worthy — every study has one.
    saveStudy(freshStudy());
    expect(backing.has(KEY)).toBe(false);
  });

  it("garbage and shape drift fall back to a fresh empty study (agentId minted)", () => {
    backing.set(KEY, "not json{");
    expect(loadStudy()).toEqual({ ...EMPTY_STUDY, agentId: expect.any(String) });
    backing.set(KEY, JSON.stringify({ prompt: 42 }));
    expect(loadStudy()).toEqual({ ...EMPTY_STUDY, agentId: expect.any(String) });
  });

  it("legacy payloads without agentId get one minted on load", () => {
    const { agentId: _dropped, ...legacy } = study();
    backing.set(KEY, JSON.stringify(legacy));
    const loaded = loadStudy();
    expect(loaded.agentId).toEqual(expect.any(String));
    expect(loaded.agentId).not.toBe("");
    expect(loaded.prompt).toBe("You are Asha.");
  });

  it("migrates legacy string turns to user turns", () => {
    backing.set(
      KEY,
      JSON.stringify({
        ...study(),
        scenarios: [{ id: "s1", scenarioId: "s1", name: "S1", language: "EN", turns: ["hi", "bye"] }],
      }),
    );
    expect(loadStudy().scenarios[0].turns).toEqual([u("hi"), u("bye")]);
  });

  it("merges a legacy gold into its scenario when the user turns match, then drops the record", () => {
    backing.set(
      KEY,
      JSON.stringify({
        ...study(),
        scenarios: [{ id: "s1", scenarioId: "s1", name: "S1", language: "EN", turns: ["hi"] }],
        golds: {
          s1: { scenarioId: "s1", language: "EN", name: "S1", turns: [u("hi"), a("hello!")] },
        },
      }),
    );
    const loaded = loadStudy();
    expect(loaded.scenarios[0].turns).toEqual([u("hi"), a("hello!")]);
    expect("golds" in loaded).toBe(false);
  });

  it("leaves the scenario user-only when a legacy gold's user turns mismatch", () => {
    backing.set(
      KEY,
      JSON.stringify({
        ...study(),
        scenarios: [{ id: "s1", scenarioId: "s1", name: "S1", language: "EN", turns: ["hi"] }],
        golds: {
          s1: { scenarioId: "s1", language: "EN", name: "S1", turns: [u("DIFFERENT"), a("hello!")] },
        },
      }),
    );
    expect(loadStudy().scenarios[0].turns).toEqual([u("hi")]);
  });

  it("coerces malformed scenario entries instead of casting them through", () => {
    backing.set(
      KEY,
      JSON.stringify({
        ...study(),
        scenarios: [
          "garbage",
          { noId: true },
          { id: "s1", turns: ["hi", 42, { role: "agent", text: "yo" }, { role: "bogus", text: "x" }] },
        ],
      }),
    );
    const loaded = loadStudy();
    expect(loaded.scenarios).toEqual([
      { id: "s1", scenarioId: "s1", name: "s1", language: "EN", turns: [u("hi"), a("yo")] },
    ]);
  });

  it("drops non-string vars and non-string models on load", () => {
    backing.set(
      KEY,
      JSON.stringify({
        ...study(),
        models: ["ok", 7],
        vars: { good: "v", bad: 3 },
      }),
    );
    const loaded = loadStudy();
    expect(loaded.models).toEqual(["ok"]);
    expect(loaded.vars).toEqual({ good: "v" });
  });
});
