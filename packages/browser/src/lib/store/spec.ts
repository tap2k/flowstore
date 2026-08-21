import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Agent, ExitPath, Flow, Spec } from "@flowstore/core/schema/v0";
import { GOTO_END } from "@flowstore/core/schema/v0";
import { genId } from "@flowstore/core/ids";
import { validateSpec } from "@flowstore/core/validation/ajv";
import { debouncedLocalStorage, isPlainObject } from "./scopedStorage";

// Open-keyed maps (vs. fixed-shape structs): a patch carries the COMPLETE map,
// so it must replace. Deep-merging one would resurrect keys the editor just
// removed — e.g. you couldn't delete a declared variable, since `{...prev,
// ...next}` keeps the dropped key from `prev`.
const REPLACE_KEYS = new Set(["variables"]);

// One-level deep merge: nested plain objects merge, arrays/primitives replace.
// Keeps partial patches like `{ meta: { identity } }` from wiping sibling fields like `meta.languages`.
// Open-keyed map fields (REPLACE_KEYS) replace instead of merging so deletions stick.
function mergePatch<T extends object>(base: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const prev = (base as Record<string, unknown>)[k];
    const merge = !REPLACE_KEYS.has(k) && isPlainObject(prev) && isPlainObject(v);
    out[k] = merge ? { ...prev, ...v } : v;
  }
  return out as T;
}

export type Selection =
  | { kind: "flow"; id: string }
  | { kind: "edge"; flowId: string; exitPathId: string }
  | null;

// The one-slot undo snapshot. Durable undo is git (edits land as diffable
// commits); the store deliberately has no history. Each mutation keeps a
// reference to the previous spec object — free under the immutable-update
// discipline — and undoLast restores it. One level, session-only: enough for
// the "Guardrail deleted — Undo" toast; anything bigger is re-edit or git.
//
// lastRename powers the rename-aware reference linter: when a flow name or a
// declared variable is renamed (inspector or sheet), the panel runs
// findDanglingReferences(spec, from) and offers non-blocking quick-fixes.
// Successive keystrokes of one rename chain (from stays the original name).
interface SpecState {
  spec: Spec | null;
  prevSpec: Spec | null;
  lastRename: { from: string; to: string } | null;
  selection: Selection;
  // One-shot intent to center the canvas on a node. Bumped any time a
  // caller wants the camera to find a node — selection alone is
  // intentionally not the trigger so user clicks don't yank the viewport.
  // Nonce makes "focus the same id again" retriggerable.
  focusRequest: { kind: "flow"; id: string; nonce: number } | null;
  setSpec: (spec: Spec | null) => void;
  // Replace the whole spec as an EDIT (quick-fix application): records the
  // undo snapshot and keeps selection, unlike setSpec (which loads a new
  // document and resets everything).
  commitSpec: (spec: Spec) => void;
  undoLast: () => void;
  clearLastRename: () => void;
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
    name: "Untitled",
    meta: { identity: "", purpose: "", modality: "voice", languages: ["EN"] },
    entry_flow_id: entryFlowId,
  };
}

// Persisted under "flowstore:spec" so an in-progress spec survives a reload
// (crash safety) and, crucially, an HMR module re-eval — persist rehydrates at
// store-creation time, where the old App-mount load effect could not. Only the
// spec itself is persisted; selection / focusRequest are ephemeral UI. The
// persisted spec is re-validated on rehydrate (merge), so a stale blob from an
// older schema can't poison the store — it falls back to null.
// Chain successive keystrokes of one rename: if the previous rename's `to` is
// what we're now renaming away from, the user is still typing — keep the
// original `from`. A rename that lands back on the original clears the record.
function chainRename(
  prev: { from: string; to: string } | null,
  from: string,
  to: string,
): { from: string; to: string } | null {
  const origin = prev && prev.to === from ? prev.from : from;
  if (!origin.trim() || origin === to) return null;
  return { from: origin, to };
}

export const useSpecStore = create<SpecState>()(
  persist(
    (set) => ({
      spec: null,
      prevSpec: null,
      lastRename: null,
      selection: null,
      focusRequest: null,
      setSpec: (spec) =>
        set({ spec, prevSpec: null, lastRename: null, selection: null, focusRequest: null }),
      commitSpec: (spec) => set((state) => ({ spec, prevSpec: state.spec })),
      undoLast: () =>
        set((state) => (state.prevSpec ? { spec: state.prevSpec, prevSpec: null } : {})),
      clearLastRename: () => set({ lastRename: null }),
      setSelection: (selection) => set({ selection }),
      requestFocus: (kind, id) =>
        set((state) => ({
          focusRequest: { kind, id, nonce: (state.focusRequest?.nonce ?? 0) + 1 },
        })),
      updateFlow: (id, patch) =>
        set((state) => {
          if (!state.spec) return {};
          const target = state.spec.flows.find((f) => f.id === id);
          const renamed =
            target && patch.name !== undefined && patch.name !== target.name
              ? chainRename(state.lastRename, target.name, patch.name)
              : state.lastRename;
          return {
            spec: {
              ...state.spec,
              flows: state.spec.flows.map((f) => (f.id === id ? mergePatch(f, patch) : f)),
            },
            prevSpec: state.spec,
            lastRename: renamed,
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
          // A variables patch that swaps exactly one key for another is a
          // variable rename (the sheet replaces the whole map) — record it for
          // the prose-reference quick-fix pass.
          let renamed = state.lastRename;
          if (patch.variables) {
            const oldKeys = Object.keys(state.spec.agent.variables ?? {});
            const newKeys = Object.keys(patch.variables);
            const removed = oldKeys.filter((k) => !newKeys.includes(k));
            const added = newKeys.filter((k) => !oldKeys.includes(k));
            if (removed.length === 1 && added.length === 1) {
              renamed = chainRename(state.lastRename, removed[0], added[0]);
            }
          }
          return {
            spec: { ...state.spec, agent: mergePatch(state.spec.agent, patch) },
            prevSpec: state.spec,
            lastRename: renamed,
          };
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
            prevSpec: state.spec,
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
            prevSpec: state.spec,
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
            prevSpec: state.spec,
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
            prevSpec: state.spec,
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
            prevSpec: state.spec,
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
