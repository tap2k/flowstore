import { describe, it, expect } from "vitest";
import { validateGraph } from "@flowstore/core/validation/graphRules";
import { validateSpec } from "@flowstore/core/validation/ajv";
import { validateTesting } from "@flowstore/core/validation/testingRules";
import type { Spec } from "@flowstore/core/schema/v0";
import type { TestingArtifacts } from "@flowstore/core/files/types";
import { loadExampleSpec } from "./fixtures";

const coffee = loadExampleSpec("coffee/coffee.json");

// Minimal graph just rich enough for the rule under test. Cast through unknown
// because validateGraph only reads a handful of fields.
function spec(overrides: {
  entry?: string | undefined;
  flows?: unknown[];
  capabilities?: unknown[];
  system_prompt?: string;
}): Spec {
  return {
    agent: {
      meta: { name: "T", modality: "voice", languages: ["EN"] },
      entry_flow_id: "entry" in overrides ? overrides.entry : "f1",
      capabilities: overrides.capabilities,
      system_prompt: overrides.system_prompt,
    },
    flows: overrides.flows ?? [{ id: "f1", type: "happy", exit_paths: [] }],
  } as unknown as Spec;
}

// Assert on the stable `code`, not on message prose.
const byCode = (issues: { code: string }[], c: string) => issues.filter((i) => i.code === c);

describe("validateGraph", () => {
  it("passes the coffee example clean", () => {
    expect(validateGraph(coffee)).toEqual([]);
  });

  it("flags a duplicate flow id", () => {
    const issues = validateGraph(
      spec({ flows: [{ id: "f1", type: "happy", exit_paths: [] }, { id: "f1", type: "sad", exit_paths: [] }] }),
    );
    const dup = byCode(issues, "duplicate-flow-id");
    expect(dup).toHaveLength(1);
    expect(dup[0].at.kind).toBe("flow");
  });

  it("flags a missing entry_flow_id", () => {
    expect(byCode(validateGraph(spec({ entry: undefined })), "entry-flow-missing")).toHaveLength(1);
  });

  it("flags an entry_flow_id that matches no flow", () => {
    expect(byCode(validateGraph(spec({ entry: "ghost" })), "entry-flow-unknown")).toHaveLength(1);
  });

  it("flags a dangling goto", () => {
    const issues = validateGraph(
      spec({ flows: [{ id: "f1", type: "happy", exit_paths: [{ id: "x1", goto: "ghost" }] }] }),
    );
    const w = byCode(issues, "goto-unknown");
    expect(w).toHaveLength(1);
    expect(w[0].at).toEqual({ kind: "edge", flowId: "f1", exitPathId: "x1" });
    expect(w[0].message).toContain("ghost"); // interpolates the offending id
  });

  it("flags an interrupt flow with no entry_condition", () => {
    const issues = validateGraph(spec({ flows: [{ id: "f1", type: "interrupt", exit_paths: [] }], entry: "f1" }));
    expect(byCode(issues, "interrupt-missing-entry-condition")).toHaveLength(1);
  });

  it("flags max_turns and condition on the same exit path", () => {
    const issues = validateGraph(
      spec({
        flows: [
          {
            id: "f1",
            type: "happy",
            exit_paths: [{ id: "x1", goto: "f1", max_turns: 3, condition: { method: "llm", expression: "done" } }],
          },
        ],
      }),
    );
    expect(byCode(issues, "max-turns-with-condition")).toHaveLength(1);
  });

  it("flags an exit action capability not in agent.capabilities", () => {
    const issues = validateGraph(
      spec({
        flows: [
          { id: "f1", type: "happy", exit_paths: [{ id: "x1", goto: "f1", actions: [{ capability_id: "nope" }] }] },
        ],
        capabilities: [{ id: "real_cap" }],
      }),
    );
    const w = byCode(issues, "unknown-capability");
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain("nope");
  });

  it("flags a flow tools entry not in agent.capabilities", () => {
    const issues = validateGraph(
      spec({
        flows: [{ id: "f1", type: "happy", exit_paths: [], tools: ["real_cap", "ghost"] }],
        capabilities: [{ id: "real_cap" }],
      }),
    );
    const w = byCode(issues, "unknown-capability");
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain("ghost");
    expect(w[0].at).toEqual({ kind: "flow", flowId: "f1" });
  });

  it("does not flag a flow tools allow-list of known capabilities", () => {
    const issues = validateGraph(
      spec({
        flows: [{ id: "f1", type: "happy", exit_paths: [], tools: ["real_cap"] }],
        capabilities: [{ id: "real_cap" }],
      }),
    );
    expect(byCode(issues, "unknown-capability")).toHaveLength(0);
  });

  describe("unreachable (orphaned) flows", () => {
    it("warns on a flow with no path from the entry flow", () => {
      const issues = validateGraph(
        spec({
          entry: "f1",
          flows: [
            { id: "f1", type: "happy", exit_paths: [] },
            { id: "f2", type: "happy", exit_paths: [] }, // nothing routes to f2
          ],
        }),
      );
      const w = byCode(issues, "unreachable-flow");
      expect(w).toHaveLength(1);
      expect(w[0].severity).toBe("warning");
      expect(w[0].at).toEqual({ kind: "flow", flowId: "f2" });
    });

    it("does not warn when the flow is reachable", () => {
      const issues = validateGraph(
        spec({
          entry: "f1",
          flows: [
            { id: "f1", type: "happy", exit_paths: [{ id: "x1", goto: "f2" }] },
            { id: "f2", type: "happy", exit_paths: [] },
          ],
        }),
      );
      expect(byCode(issues, "unreachable-flow")).toEqual([]);
    });

    it("exempts interrupt flows (globally callable, not orphans)", () => {
      const issues = validateGraph(
        spec({
          entry: "f1",
          flows: [
            { id: "f1", type: "happy", exit_paths: [] },
            { id: "int1", type: "interrupt", entry_condition: { method: "llm", expression: "x" }, exit_paths: [] },
          ],
        }),
      );
      expect(byCode(issues, "unreachable-flow")).toEqual([]);
    });

    it("is skipped entirely when the entry flow is broken", () => {
      const issues = validateGraph(
        spec({
          entry: "ghost",
          flows: [{ id: "f1", type: "happy", exit_paths: [] }],
        }),
      );
      expect(byCode(issues, "unreachable-flow")).toEqual([]);
      expect(byCode(issues, "entry-flow-unknown")).toHaveLength(1);
    });
  });

  describe("system_prompt template warnings", () => {
    it("warns (severity warning) when the template omits {generated}", () => {
      const w = byCode(validateGraph(spec({ system_prompt: "You are a bot." })), "system-prompt-missing-generated");
      expect(w).toHaveLength(1);
      expect(w[0].severity).toBe("warning");
    });

    it("warns when the template has multiple {generated}", () => {
      expect(
        byCode(validateGraph(spec({ system_prompt: "{generated} {generated}" })), "system-prompt-multiple-generated"),
      ).toHaveLength(1);
    });

    it("does not warn for a well-formed template", () => {
      const issues = validateGraph(spec({ system_prompt: "Reply briefly.\n\n{generated}" }));
      expect(byCode(issues, "system-prompt-missing-generated")).toEqual([]);
      expect(byCode(issues, "system-prompt-multiple-generated")).toEqual([]);
    });
  });
});

describe("validateSpec (ajv)", () => {
  it("accepts the coffee example", () => {
    const r = validateSpec(coffee);
    expect(r.valid).toBe(true);
  });

  it("rejects a non-spec object with errors", () => {
    const r = validateSpec({ not: "a spec" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("validateTesting", () => {
  const artifacts = (over: Partial<TestingArtifacts>): TestingArtifacts => ({
    testCases: [],
    personas: [],
    rubrics: [],
    golds: [],
    ...over,
  });

  // TestingIssue carries no `code` yet — assert on message text here.
  const hasMsg = (issues: { message: string }[], needle: string) => issues.some((i) => i.message.includes(needle));

  it("flags a persona mock key that is not a capability", () => {
    const issues = validateTesting(spec({ capabilities: [{ id: "real_cap" }] }), artifacts({
      personas: [{ id: "p1", mocks: { ghost_cap: { kind: "static", returns: {} } } } as never],
    }));
    expect(hasMsg(issues, 'mocks key "ghost_cap" is not in agent.capabilities')).toBe(true);
  });

  it("flags a test case with no actor (no user_turns / persona_id / system_prompt)", () => {
    const issues = validateTesting(null, artifacts({ testCases: [{ id: "t1" } as never] }));
    expect(hasMsg(issues, "must carry exactly one actor")).toBe(true);
  });

  it("flags a test case with more than one actor", () => {
    const issues = validateTesting(
      null,
      artifacts({ testCases: [{ id: "t1", user_turns: ["hi"], persona_id: "p1" } as never] }),
    );
    expect(hasMsg(issues, "exactly one actor allowed")).toBe(true);
  });

  it("flags a test case bound to an unknown persona", () => {
    const issues = validateTesting(null, artifacts({ testCases: [{ id: "t1", persona_id: "missing" } as never] }));
    expect(hasMsg(issues, 'persona_id "missing" not in tests/personas/')).toBe(true);
  });

  it("flags a test case mock key that is not a capability", () => {
    const issues = validateTesting(
      spec({ capabilities: [{ id: "real_cap" }] }),
      artifacts({ testCases: [{ id: "t1", user_turns: ["hi"], mocks: { ghost_cap: { kind: "static", returns: {} } } } as never] }),
    );
    expect(hasMsg(issues, 'mocks key "ghost_cap" is not in agent.capabilities')).toBe(true);
  });

  it("is clean for a well-formed scripted case", () => {
    const issues = validateTesting(coffee, artifacts({ testCases: [{ id: "t1", user_turns: ["hi"] } as never] }));
    expect(issues).toEqual([]);
  });

  it("is clean for an inline-prompt case with situational mocks", () => {
    const issues = validateTesting(
      coffee,
      artifacts({ testCases: [{ id: "t1", system_prompt: "You are a hurried customer." } as never] }),
    );
    expect(issues).toEqual([]);
  });
});

describe("validateGraph — canonical-case variable lint", () => {
  const castSpec = (parts: { variables?: Record<string, unknown>; flows: unknown[] }): Spec =>
    ({
      agent: { meta: { name: "T", modality: "voice", languages: ["EN"] }, entry_flow_id: "f1", variables: parts.variables },
      flows: parts.flows,
    } as unknown as Spec);

  const casingWarnings = (issues: { code: string }[]) => issues.filter((i) => i.code === "variable-casing");

  it("flags a {placeholder} cased differently from the declared variable", () => {
    const issues = validateGraph(
      castSpec({
        variables: { customer_name: { type: "string" } },
        flows: [{ id: "f1", type: "happy", instructions: "Hi {Customer_Name}.", exit_paths: [] }],
      }),
    );
    const w = casingWarnings(issues);
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe("warning");
    expect(w[0].at).toEqual({ kind: "flow", flowId: "f1" });
    expect(w[0].message).toContain('"Customer_Name"');
    expect(w[0].message).toContain('written "customer_name"');
  });

  it("flags a calc-expression reference cased differently (the latent-mismatch bug)", () => {
    const issues = validateGraph(
      castSpec({
        variables: { policy_id: { type: "string" } },
        flows: [
          {
            id: "f1",
            type: "happy",
            exit_paths: [{ id: "x1", goto: "END", condition: { method: "calculation", expression: 'Policy_ID == "x"' } }],
          },
        ],
      }),
    );
    const w = casingWarnings(issues);
    expect(w).toHaveLength(1);
    expect(w[0].at).toEqual({ kind: "edge", flowId: "f1", exitPathId: "x1" });
  });

  it("does NOT scan llm-method expressions (prose words are not variable refs)", () => {
    const issues = validateGraph(
      castSpec({
        variables: { policy: { type: "string" } },
        flows: [
          {
            id: "f1",
            type: "happy",
            exit_paths: [{ id: "x1", goto: "END", condition: { method: "llm", expression: "Policy verified" } }],
          },
        ],
      }),
    );
    expect(casingWarnings(issues)).toEqual([]);
  });

  it("is clean when casing is consistent", () => {
    const issues = validateGraph(
      castSpec({
        variables: { customer_name: { type: "string" } },
        flows: [{ id: "f1", type: "happy", instructions: "Hi {customer_name}.", exit_paths: [] }],
      }),
    );
    expect(casingWarnings(issues)).toEqual([]);
  });
});
