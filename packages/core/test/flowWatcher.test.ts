import { describe, it, expect } from "vitest";
import type { Spec } from "@flowstore/core/schema/v0";
import { buildTransitionTable } from "@flowstore/core/runtime/transitionTable";
import {
  resolveTransition,
  resolveDecodedPath,
  buildDecodeUserPrompt,
  type FlowPathStep,
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

function step(over: Partial<FlowPathStep>): FlowPathStep {
  return { flow_id: "order", via_exit_path_id: null, confidence: 0.9, ...over };
}

describe("resolveTransition", () => {
  it("stay: same flow as before, no edge", () => {
    const r = resolveTransition("order", step({ flow_id: "order" }), table);
    expect(r).toMatchObject({ status: "stay", flowId: "order", edgeId: null });
  });

  it("legal: reachable exit builds the canvas edge id", () => {
    const r = resolveTransition("order", step({ flow_id: "confirm", via_exit_path_id: "e_tea" }), table);
    expect(r).toMatchObject({ status: "legal", flowId: "confirm", edgeId: "order__e_tea", exitPathId: "e_tea" });
  });

  it("legal: falls back to the first shared-target exit when via is unknown", () => {
    const r = resolveTransition("order", step({ flow_id: "confirm", via_exit_path_id: null }), table);
    expect(r).toMatchObject({ status: "legal", edgeId: "order__e_coffee" });
  });

  it("interrupt: a global interrupt push is always legal, no edge", () => {
    const r = resolveTransition("order", step({ flow_id: "complaint" }), table);
    expect(r).toMatchObject({ status: "interrupt", flowId: "complaint", edgeId: null });
  });

  it("illegal: unreachable jump flags off-spec", () => {
    // greet cannot reach confirm directly, and greet can't RETURN.
    const r = resolveTransition("greet", step({ flow_id: "confirm" }), table);
    expect(r).toMatchObject({ status: "illegal", flowId: "confirm", edgeId: null });
  });

  it("return: a non-exit move to an actual caller of a returnable flow", () => {
    // faq RETURNs and confirm calls faq (confirm has e_faq → faq), so faq→confirm
    // is a plausible pop.
    const r = resolveTransition("faq", step({ flow_id: "confirm" }), table);
    expect(r).toMatchObject({ status: "return", flowId: "confirm", edgeId: null });
  });

  it("illegal: a returnable flow does NOT excuse a jump to a non-caller", () => {
    // faq can RETURN, but greet never calls faq — so faq→greet is still off-spec,
    // not masked as a return.
    const r = resolveTransition("faq", step({ flow_id: "greet" }), table);
    expect(r).toMatchObject({ status: "illegal", flowId: "greet" });
  });

  it("unknown: a hallucinated flow id keeps the prior position", () => {
    const r = resolveTransition("order", step({ flow_id: "nope_xyz" }), table);
    expect(r).toMatchObject({ status: "unknown", flowId: "order" });
  });

  it("clamps confidence to 0..1", () => {
    expect(resolveTransition("order", step({ confidence: 5 }), table).confidence).toBe(1);
    expect(resolveTransition("order", step({ confidence: -2 }), table).confidence).toBe(0);
    expect(resolveTransition("order", step({ confidence: NaN }), table).confidence).toBe(0);
  });
});

describe("resolveDecodedPath", () => {
  it("walks the path from entry, collecting legal edges + the current attribution", () => {
    // entry greet → order → confirm, then two turns staying in confirm.
    const steps: FlowPathStep[] = [
      { flow_id: "greet", via_exit_path_id: null, confidence: 0.9 }, // stay in entry
      { flow_id: "order", via_exit_path_id: "e_greet", confidence: 0.8 },
      { flow_id: "confirm", via_exit_path_id: "e_tea", confidence: 0.7 },
      { flow_id: "confirm", via_exit_path_id: null, confidence: 0.85 },
    ];
    const r = resolveDecodedPath("greet", steps, table)!;
    expect(r.traversedEdgeIds).toEqual(["greet__e_greet", "order__e_tea"]);
    expect(r.traversedFlowIds).toEqual(["greet", "order", "confirm"]);
    // last hop is a stay in confirm → the live glow shows confirm, no illegal.
    expect(r.current).toMatchObject({ status: "stay", flowId: "confirm", confidence: 0.85 });
  });

  it("pops back to the caller when the decode leaves an interrupt", () => {
    // greet → order → (complaint interrupt) → confirm. Leaving the interrupt, the
    // hop must resolve from order (the caller) not complaint, so order→confirm is
    // a legal edge — not an illegal jump with a lost edge.
    const steps: FlowPathStep[] = [
      { flow_id: "order", via_exit_path_id: "e_greet", confidence: 0.9 },
      { flow_id: "complaint", via_exit_path_id: null, confidence: 0.9 },
      { flow_id: "confirm", via_exit_path_id: "e_coffee", confidence: 0.8 },
    ];
    const r = resolveDecodedPath("greet", steps, table)!;
    expect(r.traversedEdgeIds).toEqual(["greet__e_greet", "order__e_coffee"]);
    expect(r.current).toMatchObject({ status: "legal", flowId: "confirm" });
  });

  it("surfaces an illegal jump on the last hop", () => {
    const steps: FlowPathStep[] = [
      { flow_id: "greet", via_exit_path_id: null, confidence: 0.9 },
      { flow_id: "confirm", via_exit_path_id: null, confidence: 0.6 }, // greet can't reach confirm
    ];
    const r = resolveDecodedPath("greet", steps, table)!;
    expect(r.current).toMatchObject({ status: "illegal", flowId: "confirm" });
  });

  it("returns null for an empty path", () => {
    expect(resolveDecodedPath("greet", [], table)).toBeNull();
  });
});

describe("buildDecodeUserPrompt", () => {
  const args = { transcript: [{ role: "user" as const, text: "one latte" }, { role: "agent" as const, text: "sure" }] };

  it("shows the full graph — every flow WITH its own exits", () => {
    const p = buildDecodeUserPrompt(spec(), args);
    expect(p).toContain("GRAPH");
    // order's exits AND confirm's exit both present (whole connectivity, not just one flow's).
    expect(p).toContain("e_coffee");
    expect(p).toContain("e_faq");
    expect(p).toContain(`Entry flow (every conversation starts here): greet`);
  });

  it("surfaces interrupt triggers", () => {
    const p = buildDecodeUserPrompt(spec(), args);
    expect(p).toContain("Interrupts");
    expect(p).toContain("trigger: upset");
  });

  it("numbers agent turns and asks for one entry per agent turn", () => {
    const p = buildDecodeUserPrompt(spec(), args);
    expect(p).toContain("agent[0]: sure");
    expect(p).toContain("one path entry for each of the 1 agent turn");
  });
});
