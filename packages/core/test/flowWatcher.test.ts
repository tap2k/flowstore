import { describe, it, expect } from "vitest";
import type { Spec } from "@flowstore/core/schema/v0";
import { buildTransitionTable } from "@flowstore/core/runtime/transitionTable";
import {
  resolveTransition,
  type FlowWatcherRaw,
} from "@flowstore/core/runtime/flowWatcher";

// greet → order (coffee/tea → confirm) → confirm → END; faq is callable
// (RETURNs) from confirm; complaint is a global interrupt.
function spec(): Spec {
  return {
    agent: {
      id: "a1",
      name: "cafe",
      meta: { identity: "Cafe", modality: "text" },
      entry_flow_id: "greet",
    },
    flows: [
      { id: "greet", name: "Greet", type: "happy", exit_paths: [{ id: "e_greet", goto: "order", condition: { expression: "wants to order", method: "llm" } }] },
      {
        id: "order",
        name: "Take Order",
        type: "happy",
        exit_paths: [
          { id: "e_coffee", goto: "confirm", condition: { expression: "coffee", method: "llm" } },
          { id: "e_tea", goto: "confirm", condition: { expression: "tea", method: "llm" } },
        ],
      },
      { id: "confirm", name: "Confirm", type: "happy", exit_paths: [{ id: "e_faq", goto: "faq", condition: { expression: "question", method: "llm" } }] },
      { id: "faq", name: "FAQ", type: "utility", exit_paths: [{ id: "e_ret", goto: "RETURN" }] },
      { id: "complaint", name: "Complaint", type: "interrupt", entry_condition: { expression: "upset", method: "llm" }, exit_paths: [{ id: "e_back", goto: "RETURN" }] },
    ],
  };
}

const table = buildTransitionTable(spec());

function raw(over: Partial<FlowWatcherRaw>): FlowWatcherRaw {
  return { current_flow_id: "order", via_exit_path_id: "UNKNOWN", confidence: 0.9, ...over };
}

describe("resolveTransition", () => {
  it("stay: same flow as before, no edge", () => {
    const r = resolveTransition("order", raw({ current_flow_id: "order" }), table);
    expect(r).toMatchObject({ status: "stay", flowId: "order", edgeId: null });
  });

  it("legal: reachable exit builds the canvas edge id", () => {
    const r = resolveTransition("order", raw({ current_flow_id: "confirm", via_exit_path_id: "e_tea" }), table);
    expect(r).toMatchObject({ status: "legal", flowId: "confirm", edgeId: "order__e_tea", exitPathId: "e_tea" });
  });

  it("legal: falls back to the first shared-target exit when via is UNKNOWN", () => {
    const r = resolveTransition("order", raw({ current_flow_id: "confirm", via_exit_path_id: "UNKNOWN" }), table);
    expect(r).toMatchObject({ status: "legal", edgeId: "order__e_coffee" });
  });

  it("interrupt: a global interrupt push is always legal, no edge", () => {
    const r = resolveTransition("order", raw({ current_flow_id: "complaint" }), table);
    expect(r).toMatchObject({ status: "interrupt", flowId: "complaint", edgeId: null });
  });

  it("illegal: unreachable jump flags off-spec", () => {
    // greet cannot reach confirm directly, and greet can't RETURN.
    const r = resolveTransition("greet", raw({ current_flow_id: "confirm" }), table);
    expect(r).toMatchObject({ status: "illegal", flowId: "confirm", edgeId: null });
  });

  it("return: a non-exit move to an actual caller of a returnable flow", () => {
    // faq RETURNs and confirm calls faq (confirm has e_faq → faq), so faq→confirm
    // is a plausible pop.
    const r = resolveTransition("faq", raw({ current_flow_id: "confirm" }), table);
    expect(r).toMatchObject({ status: "return", flowId: "confirm", edgeId: null });
  });

  it("illegal: a returnable flow does NOT excuse a jump to a non-caller", () => {
    // faq can RETURN, but greet never calls faq — so faq→greet is still off-spec,
    // not masked as a return.
    const r = resolveTransition("faq", raw({ current_flow_id: "greet" }), table);
    expect(r).toMatchObject({ status: "illegal", flowId: "greet" });
  });

  it("unknown: a hallucinated flow id keeps the prior position", () => {
    const r = resolveTransition("order", raw({ current_flow_id: "nope_xyz" }), table);
    expect(r).toMatchObject({ status: "unknown", flowId: "order" });
  });

  it("clamps confidence to 0..1", () => {
    expect(resolveTransition("order", raw({ confidence: 5 }), table).confidence).toBe(1);
    expect(resolveTransition("order", raw({ confidence: -2 }), table).confidence).toBe(0);
    expect(resolveTransition("order", raw({ confidence: NaN }), table).confidence).toBe(0);
  });
});
