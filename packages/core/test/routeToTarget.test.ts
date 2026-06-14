import { describe, it, expect } from "vitest";
import type { Spec } from "@flowstore/core/schema/v0";
import {
  routeToTarget,
  deriveVarsFromRoute,
} from "@flowstore/core/runtime/routeToTarget";

// Builds a small spec: entry → greet → order → confirm, with a branch at
// `order` (coffee vs tea) and a deterministic gate on the confirm exit.
function spec(): Spec {
  return {
    agent: {
      id: "a1",
      meta: { name: "Cafe", modality: "text" },
      entry_flow_id: "greet",
      capabilities: [
        { id: "cap_place", name: "place_order", description: "", kind: "function" },
      ],
    },
    flows: [
      {
        id: "greet",
        name: "Greet",
        type: "happy",
        exit_paths: [
          { id: "e_greet", goto: "order", condition: { expression: "user wants to order", method: "llm" } },
        ],
      },
      {
        id: "order",
        name: "Take Order",
        type: "happy",
        exit_paths: [
          { id: "e_coffee", goto: "confirm", condition: { expression: "user asked for coffee", method: "llm" } },
          { id: "e_tea", goto: "confirm", condition: { expression: "user asked for tea", method: "llm" } },
        ],
      },
      {
        id: "confirm",
        name: "Confirm",
        type: "happy",
        exit_paths: [
          { id: "e_done", goto: "END", condition: { expression: "order_total >= 5", method: "calculation" } },
        ],
      },
      // An interrupt flow with no incoming edge.
      {
        id: "complaint",
        name: "Handle Complaint",
        type: "interrupt",
        entry_condition: { expression: "user is upset", method: "llm" },
        exit_paths: [{ id: "e_back", goto: "RETURN" }],
      },
    ],
  } as unknown as Spec;
}

describe("routeToTarget — flow targets", () => {
  it("routes a linear path to a flow", () => {
    const r = routeToTarget(spec(), { kind: "flow", flowId: "confirm" });
    expect(r.found).toBe(true);
    expect(r.hops.map((h) => h.exitPath.id)).toEqual(["e_greet", "e_coffee"]);
    // Shortest path picks the first matching branch; that branch's condition is positive.
    expect(r.llmConditions.filter((c) => !c.negative).map((c) => c.condition.expression)).toEqual([
      "user wants to order",
      "user asked for coffee",
    ]);
    // The sibling (tea) becomes a negative avoid-condition.
    expect(r.llmConditions.filter((c) => c.negative).map((c) => c.condition.expression)).toEqual([
      "user asked for tea",
    ]);
  });

  it("entry flow itself is a zero-hop route", () => {
    const r = routeToTarget(spec(), { kind: "flow", flowId: "greet" });
    expect(r.found).toBe(true);
    expect(r.hops).toEqual([]);
    expect(r.llmConditions).toEqual([]);
  });

  it("unreachable flow returns found:false", () => {
    const s = spec();
    (s.flows as any).push({ id: "island", name: "Island", type: "happy", exit_paths: [] });
    const r = routeToTarget(s, { kind: "flow", flowId: "island" });
    expect(r.found).toBe(false);
  });

  it("missing target flow returns found:false", () => {
    const r = routeToTarget(spec(), { kind: "flow", flowId: "nope" });
    expect(r.found).toBe(false);
  });
});

describe("routeToTarget — exit targets", () => {
  it("targets a specific branch, appending it as the terminal hop with its siblings as avoids", () => {
    const r = routeToTarget(spec(), { kind: "exit", flowId: "order", exitPathId: "e_tea" });
    expect(r.found).toBe(true);
    // Route to `order`, then take the tea branch.
    expect(r.hops.map((h) => h.exitPath.id)).toEqual(["e_greet", "e_tea"]);
    expect(r.targetExit?.id).toBe("e_tea");
    const positives = r.llmConditions.filter((c) => !c.negative).map((c) => c.condition.expression);
    expect(positives).toEqual(["user wants to order", "user asked for tea"]);
    // Coffee is now the avoid.
    expect(r.llmConditions.filter((c) => c.negative).map((c) => c.condition.expression)).toEqual([
      "user asked for coffee",
    ]);
  });

  it("the structural confirm-exit condition lands in structuralConditions, not the prose", () => {
    const r = routeToTarget(spec(), { kind: "exit", flowId: "confirm", exitPathId: "e_done" });
    expect(r.found).toBe(true);
    expect(r.structuralConditions.map((c) => c.condition.expression)).toContain("order_total >= 5");
    expect(r.llmConditions.map((c) => c.condition.expression)).not.toContain("order_total >= 5");
  });

  it("missing exit on the target flow returns found:false", () => {
    const r = routeToTarget(spec(), { kind: "exit", flowId: "order", exitPathId: "nope" });
    expect(r.found).toBe(false);
  });
});

describe("routeToTarget — interrupt flow", () => {
  it("models an unreachable interrupt flow via its entry_condition", () => {
    const r = routeToTarget(spec(), { kind: "flow", flowId: "complaint" });
    expect(r.found).toBe(true);
    // The interrupt's entry_condition stands in for the (absent) incoming edge.
    expect(r.llmConditions.map((c) => c.condition.expression)).toEqual(["user is upset"]);
  });
});

describe("routeToTarget — cycles", () => {
  it("terminates and routes through a cycle", () => {
    const s: Spec = {
      agent: { id: "a", meta: { name: "x", modality: "text" }, entry_flow_id: "a" },
      flows: [
        { id: "a", name: "A", type: "happy", exit_paths: [{ id: "ab", goto: "b" }] },
        { id: "b", name: "B", type: "happy", exit_paths: [{ id: "ba", goto: "a" }, { id: "bc", goto: "c" }] },
        { id: "c", name: "C", type: "happy", exit_paths: [] },
      ],
    } as unknown as Spec;
    const r = routeToTarget(s, { kind: "flow", flowId: "c" });
    expect(r.found).toBe(true);
    expect(r.hops.map((h) => h.exitPath.id)).toEqual(["ab", "bc"]);
  });
});

describe("deriveVarsFromRoute", () => {
  function structural(expr: string, method: "calculation" | "direct" = "calculation") {
    return [{ hop: 0, condition: { expression: expr, method }, negative: false }];
  }

  it("inverts equality against a string literal", () => {
    const d = deriveVarsFromRoute(structural('loyalty_tier == "gold"'));
    expect(d.vars).toEqual({ loyalty_tier: "gold" });
    expect(d.underivable).toEqual([]);
  });

  it("inverts equality against number and boolean", () => {
    expect(deriveVarsFromRoute(structural("retries == 3")).vars).toEqual({ retries: 3 });
    expect(deriveVarsFromRoute(structural("verified == true")).vars).toEqual({ verified: true });
  });

  it("inverts comparisons to a satisfying value", () => {
    expect(deriveVarsFromRoute(structural("order_total > 50")).vars).toEqual({ order_total: 51 });
    expect(deriveVarsFromRoute(structural("order_total >= 50")).vars).toEqual({ order_total: 50 });
    expect(deriveVarsFromRoute(structural("age < 18")).vars).toEqual({ age: 17 });
    expect(deriveVarsFromRoute(structural("age <= 18")).vars).toEqual({ age: 18 });
  });

  it("refuses to guess compound expressions and reports them", () => {
    const d = deriveVarsFromRoute(structural("a > 5 and b in [1,2]"));
    expect(d.vars).toEqual({});
    expect(d.underivable).toEqual(["a > 5 and b in [1,2]"]);
  });
});
