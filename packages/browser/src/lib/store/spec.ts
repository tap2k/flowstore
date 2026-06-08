import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Agent, ExitPath, Flow, Spec } from "@flowstore/core/schema/v0";
import { GOTO_END } from "@flowstore/core/schema/v0";
import { genId } from "@flowstore/core/ids";
import { validateSpec } from "@flowstore/core/validation/ajv";
import { debouncedLocalStorage, isPlainObject } from "./scopedStorage";

// One-level deep merge: nested plain objects merge, arrays/primitives replace.
// Keeps partial patches like `{ meta: { name } }` from wiping sibling fields like `meta.languages`.
function mergePatch<T extends object>(base: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const prev = (base as Record<string, unknown>)[k];
    out[k] = isPlainObject(prev) && isPlainObject(v) ? { ...prev, ...v } : v;
  }
  return out as T;
}

export type Selection =
  | { kind: "flow"; id: string }
  | { kind: "edge"; flowId: string; exitPathId: string }
  | null;

interface SpecState {
  spec: Spec | null;
  selection: Selection;
  // One-shot intent to center the canvas on a node. Bumped any time a
  // caller wants the camera to find a node — selection alone is
  // intentionally not the trigger so user clicks don't yank the viewport.
  // Nonce makes "focus the same id again" retriggerable.
  focusRequest: { kind: "flow"; id: string; nonce: number } | null;
  setSpec: (spec: Spec | null) => void;
  setSelection: (selection: Selection) => void;
  requestFocus: (kind: "flow", id: string) => void;
  updateFlow: (id: string, patch: Partial<Flow>) => void;
  updateAgent: (patch: Partial<Agent>) => void;
  updateExitPath: (flowId: string, exitPathId: string, patch: Partial<ExitPath>) => void;
  addFlow: (select?: boolean, seed?: string) => string;
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
    exit_paths: [],
  };
}

function blankAgent(entryFlowId: string): Agent {
  return {
    id: genId("agent"),
    meta: { name: "Untitled", purpose: "", modality: "voice", languages: ["EN"] },
    entry_flow_id: entryFlowId,
  };
}

// Persisted under "flowstore:spec" so an in-progress spec survives a reload
// (crash safety) and, crucially, an HMR module re-eval — persist rehydrates at
// store-creation time, where the old App-mount load effect could not. Only the
// spec itself is persisted; selection / focusRequest are ephemeral UI. The
// persisted spec is re-validated on rehydrate (merge), so a stale blob from an
// older schema can't poison the store — it falls back to null.
export const useSpecStore = create<SpecState>()(
  persist(
    (set) => ({
      spec: null,
      selection: null,
      focusRequest: null,
      setSpec: (spec) => set({ spec, selection: null, focusRequest: null }),
      setSelection: (selection) => set({ selection }),
      requestFocus: (kind, id) =>
        set((state) => ({
          focusRequest: { kind, id, nonce: (state.focusRequest?.nonce ?? 0) + 1 },
        })),
      updateFlow: (id, patch) =>
        set((state) => {
          if (!state.spec) return {};
          return {
            spec: {
              ...state.spec,
              flows: state.spec.flows.map((f) => (f.id === id ? mergePatch(f, patch) : f)),
            },
          };
        }),
      updateAgent: (patch) =>
        set((state) => {
          // Matches addFlow's auto-bootstrap: the chat tool calls updateAgent on
          // an empty spec to set meta first, then creates the entry flow and
          // links entry_flow_id. entry_flow_id stays "" until the LLM links it
          // (validator will flag it; the chat loop surfaces that to the LLM).
          if (!state.spec) {
            return { spec: { agent: mergePatch(blankAgent(""), patch), flows: [] } };
          }
          return { spec: { ...state.spec, agent: mergePatch(state.spec.agent, patch) } };
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
                  exit_paths: f.exit_paths.map((xp) =>
                    xp.id === exitPathId ? { ...xp, ...patch } : xp
                  ),
                };
              }),
            },
          };
        }),
      addFlow: (select = false, seed) => {
        const newId = genId("flow", seed);
        set((state) => {
          const flow = blankFlow(newId);
          const nextSelection: Selection = select ? { kind: "flow", id: newId } : state.selection;
          const focusBump = select
            ? { kind: "flow" as const, id: newId, nonce: (state.focusRequest?.nonce ?? 0) + 1 }
            : state.focusRequest;
          if (!state.spec) {
            return {
              spec: { agent: blankAgent(newId), flows: [flow] },
              selection: nextSelection,
              focusRequest: focusBump,
            };
          }
          return {
            spec: { ...state.spec, flows: [...state.spec.flows, flow] },
            selection: nextSelection,
            focusRequest: focusBump,
          };
        });
        return newId;
      },
      removeFlow: (id) =>
        set((state) => {
          if (!state.spec) return {};
          const remaining = state.spec.flows.filter((f) => f.id !== id);
          // When a flow is deleted, exit paths that pointed to it become END.
          const cleaned = remaining.map((f) => ({
            ...f,
            exit_paths: f.exit_paths.map((xp) =>
              xp.goto === id ? { ...xp, goto: GOTO_END } : xp
            ),
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
                  goto: targetFlowId ?? GOTO_END,
                };
                return { ...f, exit_paths: [...f.exit_paths, newXp] };
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
                  : { ...f, exit_paths: f.exit_paths.filter((xp) => xp.id !== exitPathId) }
              ),
            },
            selection: null,
          };
        }),
    }),
    {
      name: "flowstore:spec",
      // Debounced: updateFlow fires per keystroke from the inspector, and we'd
      // otherwise serialize the whole spec on each character.
      storage: createJSONStorage(() => debouncedLocalStorage()),
      partialize: (s) => ({ spec: s.spec }),
      merge: (persisted, current) => {
        const candidate = (persisted as { spec?: unknown } | undefined)?.spec;
        const result = candidate ? validateSpec(candidate) : null;
        return { ...current, spec: result?.valid ? result.spec : null };
      },
    },
  ),
);
