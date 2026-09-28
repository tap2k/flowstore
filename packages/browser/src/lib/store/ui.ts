import { create } from "zustand";
import { persist } from "zustand/middleware";

// Entity-editor sheets. Lifted out of ImportExport's local state so the Prompt
// panel can open them too (Role → agent, Guardrails → guardrails, Knowledge →
// knowledge). Kept in sync with the sheets ImportExport renders.
export type SheetKind =
  | "agent"
  | "variables"
  | "guardrails"
  | "business_goals"
  | "capabilities"
  | "knowledge"
  | "endpoints";

const SIMULATE_TABS = ["simulate", "tests", "personas", "golds"] as const;
type SimulateTab = (typeof SIMULATE_TABS)[number];

interface UiState {
  openSheet: SheetKind | null;
  setOpenSheet: (sheet: SheetKind | null) => void;

  // Active tab inside the Run pill's SimulatePanel. "simulate" is the
  // existing live-simulate body; "tests" and "personas" are the new test
  // surfaces.
  openSimulateTab: SimulateTab;
  setOpenSimulateTab: (tab: SimulateTab) => void;

  // Whether the Run-pill SimulatePanel is open. Lifted out of App's local state
  // so deep surfaces (the flow/edge inspectors' "Load in Sim") can open it.
  simulateOpen: boolean;
  setSimulateOpen: (open: boolean) => void;

  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
}

// Only openSimulateTab persists (under "flowstore:ui") — which Run-pill tab the
// user was last on survives a reload / HMR re-eval. openSheet is ephemeral UI.
// merge falls back to "simulate" if the stored tab isn't a known value.
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      openSheet: null,
      setOpenSheet: (sheet) => set({ openSheet: sheet }),

      openSimulateTab: "simulate",
      setOpenSimulateTab: (tab) => set({ openSimulateTab: tab }),

      simulateOpen: false,
      setSimulateOpen: (open) => set({ simulateOpen: open }),

      historyOpen: false,
      setHistoryOpen: (open) => set({ historyOpen: open }),
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
