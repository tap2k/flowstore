import { describe, it, expect, beforeEach } from "vitest";
import type { Agent, Spec } from "@flowstore/core/schema/v0";
import { useSpecStore } from "@/lib/store/spec";

function baseSpec(): Spec {
  return {
    agent: {
      id: "agent_1",
      meta: { name: "X", purpose: "", modality: "voice", languages: ["EN"] },
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
    // The chat tool sends partial meta like { meta: { name } } and relies on
    // modality/languages being preserved. The map-replace fix must not regress this.
    useSpecStore.getState().updateAgent({ meta: { name: "Y" } } as Partial<Agent>);
    const meta = useSpecStore.getState().spec?.agent.meta;
    expect(meta?.name).toBe("Y");
    expect(meta?.modality).toBe("voice");
    expect(meta?.languages).toEqual(["EN"]);
  });
});
