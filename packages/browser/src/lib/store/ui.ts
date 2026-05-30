import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSpecStore } from "./spec";

// Entity-editor sheets. Lifted out of ImportExport's local state so the Prompt
// panel can open them too (Role → agent, Guardrails → guardrails, Knowledge →
// knowledge). Kept in sync with the sheets ImportExport renders.
export type SheetKind =
  | "agent"
  | "variables"
  | "guardrails"
  | "business_goals"
  | "capabilities"
  | "knowledge";

const SIMULATE_TABS = ["simulate", "tests", "personas", "golds"] as const;
type SimulateTab = (typeof SIMULATE_TABS)[number];

interface UiState {
  // Override of the compiled system prompt. null = use the freshly compiled
  // prompt. Produced by the Prompt panel's Edit mode; consumed by Simulate at
  // session start. Lives here (not in simulate.ts) because a session-scoped
  // store shouldn't own state a generic panel produces.
  promptOverride: string | null;
  // Identity of the spec object when the override was last written, for stale
  // detection. The spec object is replaced on every mutation, so reference
  // inequality means the spec changed since the edit.
  promptOverrideSpecRef: object | null;
  setPromptOverride: (text: string | null) => void;

  openSheet: SheetKind | null;
  setOpenSheet: (sheet: SheetKind | null) => void;

  // Active tab inside the Run pill's SimulatePanel. "simulate" is the
  // existing live-simulate body; "tests" and "personas" are the new test
  // surfaces.
  openSimulateTab: SimulateTab;
  setOpenSimulateTab: (tab: SimulateTab) => void;
}

// Only openSimulateTab persists (under "flowstore:ui") — which Run-pill tab the
// user was last on survives a reload / HMR re-eval. promptOverride and
// openSheet are ephemeral UI. merge falls back to "simulate" if the stored tab
// isn't a known value.
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      promptOverride: null,
      promptOverrideSpecRef: null,
      setPromptOverride: (text) =>
        set({
          promptOverride: text,
          promptOverrideSpecRef: text === null ? null : useSpecStore.getState().spec,
        }),

      openSheet: null,
      setOpenSheet: (sheet) => set({ openSheet: sheet }),

      openSimulateTab: "simulate",
      setOpenSimulateTab: (tab) => set({ openSimulateTab: tab }),
    }),
    {
      name: "flowstore:ui",
      partialize: (s) => ({ openSimulateTab: s.openSimulateTab }),
      merge: (persisted, current) => {
        const tab = (persisted as { openSimulateTab?: unknown } | undefined)?.openSimulateTab;
        return {
          ...current,
          openSimulateTab: SIMULATE_TABS.includes(tab as SimulateTab)
            ? (tab as SimulateTab)
            : "simulate",
        };
      },
    },
  ),
);
