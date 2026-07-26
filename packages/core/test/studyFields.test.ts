import { describe, it, expect } from "vitest";
import { validateFile } from "@flowstore/core/validation/ajv";
import { GoldSchema } from "@flowstore/core/schema/files/gold";
import { TestCaseSchema } from "@flowstore/core/schema/files/testCase";
import { ResultSchema } from "@flowstore/core/schema/files/result";
import { CommentSchema } from "@flowstore/core/schema/files/comment";

// The additive study fields landed 2026-07 (studies plan): gold
// language/blessed_at/scenario_id, case gold_id/scenario_id, result per-turn
// usage/latency_ms/node + rollup usage/language, and comment anchors on
// gold/result. These pin that the schemas accept them — and that the strict
// (hand-authored) schemas still reject unknown fields.

const ok = (schema: object, input: unknown) => {
  const { valid, errors } = validateFile(schema, input);
  expect(valid, JSON.stringify(errors)).toBe(true);
};

describe("gold — study fields", () => {
  const base = {
    $schema: "flowstore://test/gold/v0",
    id: "g1",
    turns: [{ role: "user", text: "hi" }, { role: "agent", text: "hello" }],
  };

  it("accepts language, blessed_at, scenario_id, and free-form source_pointer", () => {
    ok(GoldSchema, {
      ...base,
      language: "HI",
      blessed_at: "2026-07-26T00:00:00Z",
      scenario_id: "sc-refill",
      source_pointer: "compare-run:2026-07-26T00:00:00Z",
    });
  });

  it("stays strict: no provenance enum, no unknown fields", () => {
    expect(validateFile(GoldSchema, { ...base, source_kind: "captured" }).valid).toBe(false);
  });
});

describe("test case — study fields", () => {
  it("accepts gold_id and scenario_id", () => {
    ok(TestCaseSchema, {
      $schema: "flowstore://test/case/v0",
      id: "c1",
      user_turns: ["hi"],
      language: "EN",
      gold_id: "g1",
      scenario_id: "sc-refill",
    });
  });
});

describe("result — study fields", () => {
  it("accepts per-turn latency/usage/node and result-level language + rollup usage", () => {
    ok(ResultSchema, {
      $schema: "flowstore://run/result/v0",
      test_case_id: "c1",
      timestamp: "2026-07-26T00:00:00Z",
      model: "openai/gpt-4o-mini",
      prompt_source: "agent.system_prompt (imported override)",
      language: "EN",
      usage: { text_in: 100, text_out: 40, cached: 10, cost: 0.002 },
      transcript: [
        { role: "user", content: "hi" },
        {
          role: "agent",
          content: "hello",
          latency_ms: 812,
          usage: { text_in: 100, text_out: 40 },
          node: { id: "greet", mode: "inferred", confidence: 0.8 },
        },
      ],
    });
  });

  it("stays open: a newer runner's unknown fields do not invalidate", () => {
    ok(ResultSchema, {
      $schema: "flowstore://run/result/v0",
      test_case_id: "c1",
      timestamp: "t",
      transcript: [],
      future_field: { anything: true },
    });
  });
});

describe("comment anchors — blessing/adjudication", () => {
  const comment = (kind: string) => ({
    $schema: "flowstore://meta/comment/v0",
    id: "cm1",
    anchor: { kind, id: "g1" },
    author: "tapan",
    timestamp: "2026-07-26T00:00:00Z",
    body: "blessed",
    resolved: false,
  });

  it("accepts gold and result anchors", () => {
    ok(CommentSchema, comment("gold"));
    ok(CommentSchema, comment("result"));
  });

  it("rejects unknown anchor kinds", () => {
    expect(validateFile(CommentSchema, comment("scenario")).valid).toBe(false);
  });
});
