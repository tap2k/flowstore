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

import { EMPTY_STUDY, loadStudy, saveStudy } from "./studyStorage";

const KEY = "flowstore:compare:study:current";

beforeEach(() => backing.clear());
afterEach(() => backing.clear());

const study = () => ({
  ...EMPTY_STUDY,
  prompt: "You are Asha.",
  scenarios: [{ id: "s1", scenarioId: "s1", name: "S1", language: "EN", turns: ["hi"] }],
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
    saveStudy(EMPTY_STUDY);
    expect(backing.has(KEY)).toBe(false);
  });

  it("garbage and shape drift fall back to the empty study", () => {
    backing.set(KEY, "not json{");
    expect(loadStudy()).toEqual(EMPTY_STUDY);
    backing.set(KEY, JSON.stringify({ prompt: 42 }));
    expect(loadStudy()).toEqual(EMPTY_STUDY);
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
