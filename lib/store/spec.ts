import { create } from "zustand";
import type { Agent, ExitPath, Flow, Spec } from "@/lib/schema/v0";
import { genId } from "@/lib/ids";

export type Selection =
  | { kind: "flow"; id: string }
  | { kind: "edge"; flowId: string; exitPathId: string }
  | null;

interface SpecState {
  spec: Spec | null;
  selection: Selection;
  setSpec: (spec: Spec | null) => void;
  setSelection: (selection: Selection) => void;
  updateFlow: (id: string, patch: Partial<Flow>) => void;
  updateAgent: (patch: Partial<Agent>) => void;
  updateExitPath: (flowId: string, exitPathId: string, patch: Partial<ExitPath>) => void;
  addFlow: (select?: boolean) => string;
  removeFlow: (id: string) => void;
  addExitPath: (
    sourceFlowId: string,
    targetFlowId: string | null,
    select?: boolean,
  ) => string | null;
  removeExitPath: (flowId: string, exitPathId: string) => void;
}

function blankFlow(id: string): Flow {
  return {
    id,
    name: "New flow",
    type: "happy",
    routing: { exit_paths: [] },
  };
}

function blankAgent(entryFlowId: string): Agent {
  return {
    id: genId("agent"),
    meta: { name: "Untitled", purpose: "", languages: ["EN"], modes: ["voice"] },
    entry_flow_id: entryFlowId,
  };
}

export const useSpecStore = create<SpecState>((set) => ({
  spec: null,
  selection: null,
  setSpec: (spec) => set({ spec, selection: null }),
  setSelection: (selection) => set({ selection }),
  updateFlow: (id, patch) =>
    set((state) => {
      if (!state.spec) return {};
      return {
        spec: {
          ...state.spec,
          flows: state.spec.flows.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        },
      };
    }),
  updateAgent: (patch) =>
    set((state) => {
      if (!state.spec) return {};
      return { spec: { ...state.spec, agent: { ...state.spec.agent, ...patch } } };
    }),
  updateExitPath: (flowId, exitPathId, patch) =>
    set((state) => {
      if (!state.spec) return {};
      return {
        spec: {
          ...state.spec,
          flows: state.spec.flows.map((f) => {
            if (f.id !== flowId) return f;
            return {
              ...f,
              routing: {
                ...f.routing,
                exit_paths: f.routing.exit_paths.map((xp) =>
                  xp.id === exitPathId ? { ...xp, ...patch } : xp
                ),
              },
            };
          }),
        },
      };
    }),
  addFlow: (select = false) => {
    const newId = genId("flow");
    set((state) => {
      const flow = blankFlow(newId);
      const nextSelection: Selection = select ? { kind: "flow", id: newId } : state.selection;
      if (!state.spec) {
        return {
          spec: { agent: blankAgent(newId), flows: [flow] },
          selection: nextSelection,
        };
      }
      return {
        spec: { ...state.spec, flows: [...state.spec.flows, flow] },
        selection: nextSelection,
      };
    });
    return newId;
  },
  removeFlow: (id) =>
    set((state) => {
      if (!state.spec) return {};
      const remaining = state.spec.flows.filter((f) => f.id !== id);
      const cleaned = remaining.map((f) => ({
        ...f,
        scope: f.scope?.filter((s) => s !== id),
        routing: {
          ...f.routing,
          exit_paths: f.routing.exit_paths.map((xp) =>
            xp.next_flow_id === id ? { ...xp, next_flow_id: null } : xp
          ),
        },
      }));
      const entry =
        state.spec.agent.entry_flow_id === id
          ? cleaned[0]?.id ?? ""
          : state.spec.agent.entry_flow_id;
      return {
        spec: {
          ...state.spec,
          agent: { ...state.spec.agent, entry_flow_id: entry },
          flows: cleaned,
        },
        selection: null,
      };
    }),
  addExitPath: (sourceFlowId, targetFlowId, select = false) => {
    const xpId = genId("xp");
    let added = false;
    set((state) => {
      if (!state.spec) return {};
      if (!state.spec.flows.some((f) => f.id === sourceFlowId)) return {};
      added = true;
      return {
        spec: {
          ...state.spec,
          flows: state.spec.flows.map((f) => {
            if (f.id !== sourceFlowId) return f;
            const newXp: ExitPath = {
              id: xpId,
              type: "happy",
              next_flow_id: targetFlowId,
            };
            return {
              ...f,
              routing: { ...f.routing, exit_paths: [...f.routing.exit_paths, newXp] },
            };
          }),
        },
        selection: select
          ? { kind: "edge", flowId: sourceFlowId, exitPathId: xpId }
          : state.selection,
      };
    });
    return added ? xpId : null;
  },
  removeExitPath: (flowId, exitPathId) =>
    set((state) => {
      if (!state.spec) return {};
      return {
        spec: {
          ...state.spec,
          flows: state.spec.flows.map((f) =>
            f.id !== flowId
              ? f
              : {
                  ...f,
                  routing: {
                    ...f.routing,
                    exit_paths: f.routing.exit_paths.filter((xp) => xp.id !== exitPathId),
                  },
                }
          ),
        },
        selection: null,
      };
    }),
}));
