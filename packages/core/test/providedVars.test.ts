import { describe, it, expect } from "vitest";
import type { Spec } from "@flowstore/core/schema/v0";
import { providedVars } from "@flowstore/core/runtime/contextVars";
import { validateGraph } from "@flowstore/core/validation/graphRules";

// The party-scoping contract: fixture vars are a character sheet, and the
// ONLY keys that reach the agent's initial state are those whose agent-level
// declaration says provided: true (the session-start payload). Everything
// else must be earned through conversation or capability returns — these
// tests pin the boundary so a regression here is a test-fidelity leak, not
// a cosmetic bug.
const spec = {
  agent: {
    id: "a1",
    name: "collections",
    meta: { identity: "Collections", modality: "voice" },
    entry_flow_id: "f1",
    variables: {
      customer_name: { type: "string", provided: true },
      total_due_amount: { type: "number", provided: true, visible_when: "identity_confirmed" },
      policy_id: { type: "string" }, // elicited — never seeds
      identity_confirmed: { type: "boolean" }, // derived — never seeds
    },
  },
  flows: [
    {
      id: "f1",
      name: "Verify",
      type: "conversation",
      exit_paths: [],
      variables: {
        // provided is inert on flow vars; the lint below flags it.
        scratch: { type: "string", provided: true },
      },
    },
  ],
} as unknown as Spec;

describe("providedVars", () => {
  it("ships only provided-declared keys from a character sheet", () => {
    const sheet = {
      customer_name: "Maria Reyes",
      total_due_amount: 4400,
      policy_id: "POL-99812", // the fact the flow under test must elicit
      identity_confirmed: true, // derived state a fixture must not inject
      undeclared: "x",
    };
    expect(providedVars(spec, sheet)).toEqual({
      customer_name: "Maria Reyes",
      total_due_amount: 4400,
    });
  });

  it("never seeds flow-level vars, even when marked provided", () => {
    expect(providedVars(spec, { scratch: "leak" })).toEqual({});
  });

  it("empty sheet and undeclared agent stay empty", () => {
    expect(providedVars(spec, {})).toEqual({});
    const bare = { ...spec, agent: { ...spec.agent, variables: undefined } } as Spec;
    expect(providedVars(bare, { customer_name: "Maria" })).toEqual({});
  });
});

describe("validateGraph — provided-on-flow-variable", () => {
  it("warns when a flow variable carries provided", () => {
    const issues = validateGraph(spec).filter((i) => i.code === "provided-on-flow-variable");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].at).toEqual({ kind: "flow", flowId: "f1" });
    expect(issues[0].message).toContain("scratch");
  });
});
