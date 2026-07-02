import { describe, it, expect } from "vitest";
import type { Spec } from "@flowstore/core/schema/v0";
import {
  buildTransitionTable,
  interruptFlowIds,
  findExitTo,
} from "@flowstore/core/runtime/transitionTable";

// entry → greet → order (branch: coffee/tea both → confirm) → confirm → END,
// plus a global interrupt (complaint) and a callable sub-flow reached from
// confirm that RETURNs.
function spec(): Spec {
  return {
    agent: {
      id: "a1",
      name: "cafe",
      meta: { identity: "Cafe", modality: "text" },
      entry_flow_id: "greet",
    },
    flows: [
      {
        id: "greet",
        name: "Greet",
        type: "happy",
        exit_paths: [
          { id: "e_greet", goto: "order", condition: { expression: "wants to order", method: "llm" } },
        ],
      },
      {
        id: "order",
        name: "Take Order",
        type: "happy",
        exit_paths: [
          { id: "e_coffee", goto: "confirm", condition: { expression: "asked for coffee", method: "llm" } },
          { id: "e_tea", goto: "confirm", condition: { expression: "asked for tea", method: "llm" } },
          // conditionless fallback
          { id: "e_stuck", goto: "greet" },
          // turn-budget escape
          { id: "e_budget", goto: "END", max_turns: 3 },
        ],
      },
      {
        id: "confirm",
        name: "Confirm",
        type: "happy",
        exit_paths: [
          { id: "e_done", goto: "END", condition: { expression: "order_total >= 5", method: "calculation" } },
          { id: "e_help", goto: "faq", condition: { expression: "user has a question", method: "llm" } },
        ],
      },
      {
        id: "faq",
        name: "FAQ",
        type: "utility",
        exit_paths: [{ id: "e_return", goto: "RETURN" }],
      },
      {
        id: "complaint",
        name: "Handle Complaint",
        type: "interrupt",
        entry_condition: { expression: "user is upset", method: "llm" },
        exit_paths: [{ id: "e_back", goto: "RETURN" }],
      },
    ],
  };
}

describe("buildTransitionTable", () => {
  it("classifies exit kinds, fallbacks, and budget escapes", () => {
    const t = buildTransitionTable(spec());
    const order = t.get("order")!;
    // 4 authored exits + 1 global interrupt.
    expect(order).toHaveLength(5);

    const coffee = order.find((x) => x.exitPathId === "e_coffee")!;
    expect(coffee).toMatchObject({ kind: "exit", toFlowId: "confirm", method: "llm", isFallback: false, isBudget: false });

    const stuck = order.find((x) => x.exitPathId === "e_stuck")!;
    expect(stuck).toMatchObject({ kind: "exit", toFlowId: "greet", method: null, isFallback: true, isBudget: false });

    const budget = order.find((x) => x.exitPathId === "e_budget")!;
    expect(budget).toMatchObject({ kind: "end", toFlowId: null, isFallback: false, isBudget: true });
  });

  it("maps END and RETURN to null targets", () => {
    const t = buildTransitionTable(spec());
    const done = t.get("confirm")!.find((x) => x.exitPathId === "e_done")!;
    expect(done).toMatchObject({ kind: "end", toFlowId: null });
    const ret = t.get("faq")!.find((x) => x.exitPathId === "e_return")!;
    expect(ret).toMatchObject({ kind: "return", toFlowId: null });
  });

  it("adds a global interrupt-push to every flow", () => {
    const t = buildTransitionTable(spec());
    for (const flowId of ["greet", "order", "confirm", "faq", "complaint"]) {
      const push = t.get(flowId)!.find((x) => x.kind === "interrupt");
      expect(push, `interrupt push missing from ${flowId}`).toMatchObject({
        toFlowId: "complaint",
        exitPathId: null,
        method: "llm",
      });
    }
  });
});

describe("interruptFlowIds", () => {
  it("collects the interrupt-push targets the table encodes", () => {
    const t = buildTransitionTable(spec());
    expect(interruptFlowIds(t)).toEqual(new Set(["complaint"]));
  });

  it("is empty when the spec has no interrupt flows", () => {
    const s = spec();
    s.flows = s.flows.filter((f) => f.type !== "interrupt");
    expect(interruptFlowIds(buildTransitionTable(s))).toEqual(new Set());
  });
});

describe("findExitTo", () => {
  it("disambiguates shared-target exits by preference, else first", () => {
    const t = buildTransitionTable(spec());
    expect(findExitTo(t, "order", "confirm", "e_tea")!.exitPathId).toBe("e_tea");
    expect(findExitTo(t, "order", "confirm")!.exitPathId).toBe("e_coffee");
  });

  it("returns null when no authored exit reaches the target", () => {
    const t = buildTransitionTable(spec());
    // complaint is reachable only via interrupt-push, not an exit.
    expect(findExitTo(t, "order", "complaint")).toBeNull();
    // confirm is not reachable from greet at all.
    expect(findExitTo(t, "greet", "confirm")).toBeNull();
  });
});
