import { create } from "zustand";
import { useSpecStore } from "./spec";

// Ephemeral record of what the ASSISTANT changed on the canvas, so its edits
// are attributable at a glance. The invariant the canvas renders is
// "glow = not your hands": explicit user edits never mark anything here —
// the user caused those and the camera/selection already carry them. Chat
// tool impls mark flows/edges as they mutate the spec; ChatPanel commits the
// turn when its agent loop settles, which promotes the pending marks to the
// glowing set, points the camera at the primary change once (not per tool
// call — a five-call turn shouldn't yank the viewport five times), and
// schedules the glow to fade. Never persisted: attribution of a live turn is
// meaningless after a reload.
const GLOW_MS = 8000;

interface AssistantChangesState {
  // Accumulated during the current assistant turn.
  pendingFlowIds: string[];
  pendingCreatedFlowIds: string[];
  pendingEdgeIds: string[];
  // What the canvas glows. Ids that stop resolving (deleted flow, re-routed
  // edge) are harmless — the canvas only styles entities that still render.
  glowFlowIds: string[];
  glowEdgeIds: string[];
  markFlow: (id: string, opts?: { created?: boolean }) => void;
  markEdge: (id: string) => void;
  // A flow deleted later in the same turn must not glow or take the camera.
  unmarkFlow: (id: string) => void;
  commitTurn: () => void;
  clearGlow: () => void;
}

function addUnique(arr: string[], id: string): string[] {
  return arr.includes(id) ? arr : [...arr, id];
}

let glowTimer: ReturnType<typeof setTimeout> | null = null;

export const useAssistantChangesStore = create<AssistantChangesState>()((set, get) => ({
  pendingFlowIds: [],
  pendingCreatedFlowIds: [],
  pendingEdgeIds: [],
  glowFlowIds: [],
  glowEdgeIds: [],
  markFlow: (id, opts) =>
    set((s) => ({
      pendingFlowIds: addUnique(s.pendingFlowIds, id),
      pendingCreatedFlowIds: opts?.created
        ? addUnique(s.pendingCreatedFlowIds, id)
        : s.pendingCreatedFlowIds,
    })),
  markEdge: (id) => set((s) => ({ pendingEdgeIds: addUnique(s.pendingEdgeIds, id) })),
  unmarkFlow: (id) =>
    set((s) => ({
      pendingFlowIds: s.pendingFlowIds.filter((f) => f !== id),
      pendingCreatedFlowIds: s.pendingCreatedFlowIds.filter((f) => f !== id),
    })),
  commitTurn: () => {
    const s = get();
    const touchedAnything =
      s.pendingFlowIds.length > 0 || s.pendingEdgeIds.length > 0;
    if (!touchedAnything) return;

    // Primary change = the newest created flow, else the last flow touched.
    // Focus follows the same fitView plumbing as the user's "+" button, but
    // deliberately WITHOUT selection: the assistant stealing the selection
    // would clobber whatever the user has open in the inspector mid-turn.
    const flows = useSpecStore.getState().spec?.flows ?? [];
    const exists = (id: string) => flows.some((f) => f.id === id);
    const focusTarget =
      [...s.pendingCreatedFlowIds].reverse().find(exists) ??
      [...s.pendingFlowIds].reverse().find(exists);
    if (focusTarget) useSpecStore.getState().requestFocus("flow", focusTarget);

    set({
      glowFlowIds: s.pendingFlowIds,
      glowEdgeIds: s.pendingEdgeIds,
      pendingFlowIds: [],
      pendingCreatedFlowIds: [],
      pendingEdgeIds: [],
    });
    if (glowTimer) clearTimeout(glowTimer);
    glowTimer = setTimeout(() => get().clearGlow(), GLOW_MS);
  },
  clearGlow: () => set({ glowFlowIds: [], glowEdgeIds: [] }),
}));
