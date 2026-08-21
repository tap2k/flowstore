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

describe("useSpecStore — multilingual policy guardrail seeding", () => {
  beforeEach(() => {
    useSpecStore.getState().setSpec(baseSpec());
  });

  const goMulti = () =>
    useSpecStore.getState().updateAgent({ meta: { languages: ["EN", "ES"] } } as Partial<Agent>);
  const guardrailIds = () =>
    (useSpecStore.getState().spec?.agent.guardrails ?? []).map((g) => g.id);

  it("going 1→many languages seeds gr_multilingual_policy", () => {
    goMulti();
    expect(guardrailIds()).toContain("gr_multilingual_policy");
  });

  it("seeds once — already-multilingual edits don't duplicate it", () => {
    goMulti();
    useSpecStore
      .getState()
      .updateAgent({ meta: { languages: ["EN", "ES", "fr"] } } as Partial<Agent>);
    expect(guardrailIds().filter((id) => id === "gr_multilingual_policy")).toHaveLength(1);
  });

  it("deleting it while multilingual is respected", () => {
    goMulti();
    useSpecStore.getState().updateAgent({ guardrails: undefined });
    useSpecStore
      .getState()
      .updateAgent({ meta: { languages: ["EN", "ES", "fr"] } } as Partial<Agent>);
    expect(guardrailIds()).not.toContain("gr_multilingual_policy");
  });
});
