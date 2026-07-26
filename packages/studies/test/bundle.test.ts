import { describe, it, expect } from "vitest";
import { loadProject } from "@flowstore/core/files";
import { validateFile } from "@flowstore/core/validation/ajv";
import { GoldSchema } from "@flowstore/core/schema/files/gold";
import { TestCaseSchema } from "@flowstore/core/schema/files/testCase";
import { ResultSchema } from "@flowstore/core/schema/files/result";
import { buildStudyBundle } from "../src/bundle";
import type { CellState, Scenario } from "../src/types";
import { cellKey } from "../src/types";

const scenarios: Scenario[] = [
  { id: "s1", scenarioId: "sc-refill", name: "Refill request", language: "EN", turns: ["hi", "refill please"] },
  { id: "s2", scenarioId: "sc-refill", name: "Refill request (HI)", language: "HI", turns: ["namaste"] },
];
const models = ["openai/gpt-4o-mini", "meta-llama/llama-3.1-8b-instruct:free"];

const doneCell = (text: string): CellState => ({
  status: "done",
  totalMs: 1234,
  usage: { inputTokens: 100, outputTokens: 40, cost: 0.0021 },
  turns: [
    { role: "user", text: "hi", ts: 0, events: [] },
    { role: "agent", text, ts: 0, events: [], latencyMs: 800 },
  ],
});

// s2 × column 1 errored — it must be absent from results and manifest.
const cells: Record<string, CellState> = {
  [cellKey("s1", 0)]: doneCell("Hello! I can help with your refill."),
  [cellKey("s1", 1)]: doneCell("Sure, refill coming up."),
  [cellKey("s2", 0)]: doneCell("Namaste! Main madad kar sakti hoon."),
  [cellKey("s2", 1)]: { status: "error", turns: [], totalMs: 0, error: "rate limited" },
};

const golds = {
  s1: {
    scenarioId: "sc-refill",
    language: "EN",
    name: "Refill request",
    turns: [
      { role: "user" as const, text: "hi" },
      { role: "agent" as const, text: "Hello! I can help with your refill." },
    ],
  },
};

const files = buildStudyBundle({ prompt: "You are Asha, a clinic assistant.", models, scenarios, cells, golds });

describe("buildStudyBundle", () => {
  it("every emitted file parses as JSON", () => {
    for (const [path, content] of Object.entries(files)) {
      expect(() => JSON.parse(content), path).not.toThrow();
    }
  });

  it("agent.json carries the verbatim prompt as a full override with a stub entry flow", () => {
    const agent = JSON.parse(files["agent.json"]);
    expect(agent.system_prompt).toBe("You are Asha, a clinic assistant.");
    expect(agent.entry_flow_id).toBe("");
    expect(agent.meta.languages).toEqual(["EN", "HI"]);
  });

  it("scenarios serialize as valid test cases with language and scenario_id", () => {
    for (const s of scenarios) {
      const parsed = JSON.parse(files[`tests/cases/${s.id}.test.json`]);
      const { valid, errors } = validateFile(TestCaseSchema, parsed);
      expect(valid, JSON.stringify(errors)).toBe(true);
      expect(parsed.scenario_id).toBe("sc-refill");
      expect(parsed.language).toBe(s.language);
    }
  });

  it("only done cells become results, each valid with usage mapped to unit-typed fields", () => {
    const resultPaths = Object.keys(files).filter((p) => p.endsWith(".result.json"));
    expect(resultPaths).toHaveLength(3);
    for (const p of resultPaths) {
      const parsed = JSON.parse(files[p]);
      const { valid, errors } = validateFile(ResultSchema, parsed);
      expect(valid, JSON.stringify(errors)).toBe(true);
      expect(parsed.usage).toEqual({ text_in: 100, text_out: 40, cost: 0.0021 });
      expect(parsed.transcript.at(-1).latency_ms).toBe(800);
      expect(parsed.prompt_source).toMatch(/imported override/);
    }
  });

  it("model ids are sanitized in result paths", () => {
    const paths = Object.keys(files).filter((p) => p.endsWith(".result.json"));
    expect(paths.some((p) => p.includes("meta-llama_llama-3.1-8b-instruct_free"))).toBe(true);
    for (const p of paths) {
      expect(p.split("/").length, p).toBe(4); // tests/runs/<dir>/<file> — no stray slashes from model ids
    }
  });

  it("the manifest indexes exactly the emitted results and names the incumbent", () => {
    const manifestPath = Object.keys(files).find((p) => p.endsWith("manifest.json"))!;
    const manifest = JSON.parse(files[manifestPath]);
    expect(manifest.incumbent).toBe(models[0]);
    expect(manifest.scenario_ids).toEqual(["s1", "s2"]);
    expect(manifest.results).toHaveLength(3);
    for (const p of manifest.results) expect(files[p], p).toBeDefined();
  });

  it("captured golds serialize as valid blessed gold files", () => {
    const parsed = JSON.parse(files["tests/gold/s1.gold.json"]);
    const { valid, errors } = validateFile(GoldSchema, parsed);
    expect(valid, JSON.stringify(errors)).toBe(true);
    expect(parsed.blessed_at).toBeTruthy();
    expect(parsed.source_pointer).toMatch(/^compare-run:/);
    expect(parsed.scenario_id).toBe("sc-refill");
    expect(parsed.language).toBe("EN");
  });

  it("placeholder-fill vars ship as provided declarations + case fixtures, prompt untouched", () => {
    const withVars = buildStudyBundle({
      prompt: "You are Asha at {{clinic_name}}.",
      models,
      scenarios,
      cells,
      vars: { clinic_name: "Sunrise Clinic", empty_one: "  " },
    });
    const agent = JSON.parse(withVars["agent.json"]);
    // The prompt stays byte-verbatim — fill is a session bag, never a rewrite.
    expect(agent.system_prompt).toBe("You are Asha at {{clinic_name}}.");
    expect(agent.variables).toEqual({ clinic_name: { type: "string", provided: true } });
    for (const s of scenarios) {
      const c = JSON.parse(withVars[`tests/cases/${s.id}.test.json`]);
      expect(c.vars).toEqual({ clinic_name: "Sunrise Clinic" });
      expect(validateFile(TestCaseSchema, c).valid).toBe(true);
    }
    // No vars → no declarations, no fixtures.
    const bare = JSON.parse(files["agent.json"]);
    expect(bare.variables).toBeUndefined();
  });

  it("re-exporting an imported gold preserves its identity and blessing (no re-bless)", () => {
    const roundTrip = buildStudyBundle({
      prompt: "p",
      models,
      scenarios,
      cells,
      golds: {
        s1: {
          ...golds.s1,
          goldId: "gold-orig",
          blessedAt: "2026-07-01T00:00:00Z",
          sourcePointer: "call-recording-2026-06-30",
        },
      },
    });
    const parsed = JSON.parse(roundTrip["tests/gold/s1.gold.json"]);
    expect(parsed.id).toBe("gold-orig");
    expect(parsed.blessed_at).toBe("2026-07-01T00:00:00Z");
    expect(parsed.source_pointer).toBe("call-recording-2026-06-30");
  });

  it("loads as a project in the editor's loader — the graduation contract", () => {
    const { spec, testingArtifacts, errors } = loadProject(files);
    expect(errors, JSON.stringify(errors)).toEqual([]);
    expect(spec?.agent.system_prompt).toBe("You are Asha, a clinic assistant.");
    expect(spec?.flows).toEqual([]); // flowless imported project — accepted
    expect(testingArtifacts?.testCases).toHaveLength(2);
    expect(testingArtifacts?.golds).toHaveLength(1);
  });

  it("omits the gold section entirely when no golds were captured", () => {
    const bare = buildStudyBundle({ prompt: "p", models, scenarios, cells });
    expect(Object.keys(bare).some((p) => p.startsWith("tests/gold/"))).toBe(false);
  });
});
