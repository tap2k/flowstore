import { describe, it, expect, beforeEach } from "vitest";
import type { Agent, Spec } from "@flowstore/core/schema/v0";
import { useSpecStore } from "@/lib/store/spec";

function baseSpec(): Spec {
  return {
    agent: {
      id: "agent_1",
      name: "x",
      meta: { identity: "X", purpose: "", modality: "voice", languages: ["EN"] },
      entry_flow_id: "f1",
      variables: { a: { type: "string" }, b: { type: "number" } },
    },
    flows: [
      {
        id: "f1",
        name: "F1",
        type: "happy",
        exit_paths: [],
        variables: { p: { type: "string" }, q: { type: "boolean" } },
      },
    ],
  };
}

describe("useSpecStore — variable declaration removal", () => {
  beforeEach(() => {
    useSpecStore.getState().setSpec(baseSpec());
  });

  it("removes an agent variable declaration (map replaces, not merges)", () => {
    // Editor sends the COMPLETE remaining map after deleting `b`.
    useSpecStore.getState().updateAgent({ variables: { a: { type: "string" } } });
    expect(useSpecStore.getState().spec?.agent.variables).toEqual({ a: { type: "string" } });
  });

  it("removes the last agent variable (undefined clears the map)", () => {
    useSpecStore.getState().updateAgent({ variables: undefined });
    expect(useSpecStore.getState().spec?.agent.variables).toBeUndefined();
  });

  it("removes a flow variable declaration", () => {
    useSpecStore.getState().updateFlow("f1", { variables: { p: { type: "string" } } });
    const flow = useSpecStore.getState().spec?.flows.find((f) => f.id === "f1");
    expect(flow?.variables).toEqual({ p: { type: "string" } });
  });

  it("still deep-merges a partial meta patch — siblings survive", () => {
    // The chat tool sends partial meta like { meta: { identity } } and relies on
    // modality/languages being preserved. The map-replace fix must not regress this.
    useSpecStore.getState().updateAgent({ meta: { identity: "Y" } } as Partial<Agent>);
    const meta = useSpecStore.getState().spec?.agent.meta;
    expect(meta?.identity).toBe("Y");
    expect(meta?.modality).toBe("voice");
    expect(meta?.languages).toEqual(["EN"]);
  });
});

describe("useSpecStore — one-slot undo snapshot", () => {
  beforeEach(() => {
    useSpecStore.getState().setSpec(baseSpec());
  });

  it("undoLast reverses the most recent mutation, one level only", () => {
    const s = useSpecStore.getState;
    s().updateAgent({ guardrails: [{ id: "g1", statement: "one" }] });
    s().updateAgent({ guardrails: [] }); // the delete
    expect(s().spec?.agent.guardrails).toEqual([]);
    s().undoLast();
    expect(s().spec?.agent.guardrails).toEqual([{ id: "g1", statement: "one" }]);
    // one level: a second undo is a no-op.
    const after = s().spec;
    s().undoLast();
    expect(s().spec).toBe(after);
  });

  it("setSpec (loading a document) clears the snapshot; commitSpec records one", () => {
    const s = useSpecStore.getState;
    s().updateFlow("f1", { name: "F1b" });
    s().setSpec(baseSpec());
    expect(s().prevSpec).toBeNull();
    const edited = structuredClone(s().spec!);
    edited.flows[0].instructions = "hi";
    s().commitSpec(edited);
    expect(s().spec?.flows[0].instructions).toBe("hi");
    s().undoLast();
    expect(s().spec?.flows[0].instructions).toBeUndefined();
  });
});

describe("useSpecStore — rename tracking for the prose-reference linter", () => {
  beforeEach(() => {
    useSpecStore.getState().setSpec(baseSpec());
  });

  it("records a flow rename and chains keystrokes back to the original name", () => {
    const s = useSpecStore.getState;
    s().updateFlow("f1", { name: "F2" });
    expect(s().lastRename).toEqual({ from: "F1", to: "F2" });
    // Continued typing chains: from stays the original.
    s().updateFlow("f1", { name: "F2x" });
    expect(s().lastRename).toEqual({ from: "F1", to: "F2x" });
    // Typing back to the original clears the record.
    s().updateFlow("f1", { name: "F1" });
    expect(s().lastRename).toBeNull();
  });

  it("detects a variable rename in a whole-map variables patch", () => {
    const s = useSpecStore.getState;
    s().updateAgent({ variables: { a: { type: "string" }, c: { type: "number" } } });
    expect(s().lastRename).toEqual({ from: "b", to: "c" });
    // Pure addition or removal is not a rename.
    s().clearLastRename();
    s().updateAgent({ variables: { a: { type: "string" } } });
    expect(s().lastRename).toBeNull();
  });
});
