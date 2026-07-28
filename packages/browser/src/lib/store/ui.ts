import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSpecStore } from "./spec";

// Entity-editor sections. Each is a tab in the left rail, rendered into the
// docked left panel. The Prompt panel opens these too (Role → agent, Guardrails
// → guardrails, Knowledge → knowledge), which is why the state lives here
// rather than in whichever component owns the rail.
export type SheetKind =
  | "agent"
  | "variables"
  | "guardrails"
  | "business_goals"
  | "capabilities"
  | "knowledge"
  | "endpoints";

// The left panel shows exactly one rail tab's contents at a time — "prompt" is
// the compiled system prompt, the rest are the spec-section editors above.
// null = the panel is collapsed to just the rail.
export type LeftTab = "prompt" | SheetKind;

const SIMULATE_TABS = ["simulate", "tests", "personas", "golds"] as const;
type SimulateTab = (typeof SIMULATE_TABS)[number];

const LEFT_TABS: readonly LeftTab[] = [
  "prompt",
  "agent",
  "variables",
  "guardrails",
  "business_goals",
  "capabilities",
  "knowledge",
  "endpoints",
];

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

  // Which rail tab the docked left panel is showing. Rail buttons behave as
  // TABS, not toggles-per-sheet: opening one replaces whatever was there, and
  // re-clicking the active one collapses the panel (see toggleLeftTab).
  leftTab: LeftTab | null;
  setLeftTab: (tab: LeftTab | null) => void;
  toggleLeftTab: (tab: LeftTab) => void;

  // Active tab inside the Run pill's SimulatePanel. "simulate" is the
  // existing live-simulate body; "tests" and "personas" are the new test
  // surfaces.
  openSimulateTab: SimulateTab;
  setOpenSimulateTab: (tab: SimulateTab) => void;

  // Whether the SimulatePanel is open. Lifted out of App's local state so deep
  // surfaces (the flow/edge inspectors' "Load in Sim") can open it.
  simulateOpen: boolean;
  setSimulateOpen: (open: boolean) => void;

  // The assistant panel. Same reason it lives here: the canvas action bar and
  // the rail both open it, and neither owns the other.
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;

  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;

  // Canvas minimap visibility, set from Settings → Preferences. Persists like
  // a display preference (theme), unlike the ephemeral panels above.
  minimapVisible: boolean;
  setMinimapVisible: (visible: boolean) => void;
}

// Two things persist (under "flowstore:ui"): which Simulate tab the user was
// last on, and which rail tab the left panel is showing. The left panel is a
// place you leave open — reopening the app into a bare canvas when you were
// mid-edit in Guardrails would be a regression, where a transient drawer
// reappearing would be noise. The right-hand panels stay ephemeral for exactly
// that reason. promptOverride is session state and never persists.
// Both merges fall back when the stored value isn't a known one.
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

      leftTab: null,
      setLeftTab: (tab) => set({ leftTab: tab }),
      toggleLeftTab: (tab) => set((s) => ({ leftTab: s.leftTab === tab ? null : tab })),

      openSimulateTab: "simulate",
      setOpenSimulateTab: (tab) => set({ openSimulateTab: tab }),

      simulateOpen: false,
      setSimulateOpen: (open) => set({ simulateOpen: open }),

      chatOpen: false,
      setChatOpen: (open) => set({ chatOpen: open }),

      historyOpen: false,
      setHistoryOpen: (open) => set({ historyOpen: open }),

      minimapVisible: true,
      setMinimapVisible: (visible) => set({ minimapVisible: visible }),
    }),
    {
      name: "flowstore:ui",
      partialize: (s) => ({
        openSimulateTab: s.openSimulateTab,
        leftTab: s.leftTab,
        minimapVisible: s.minimapVisible,
      }),
      merge: (persisted, current) => {
        const p = persisted as
          | { openSimulateTab?: unknown; leftTab?: unknown; minimapVisible?: unknown }
          | undefined;
        return {
          ...current,
          openSimulateTab: SIMULATE_TABS.includes(p?.openSimulateTab as SimulateTab)
            ? (p?.openSimulateTab as SimulateTab)
            : "simulate",
          leftTab: LEFT_TABS.includes(p?.leftTab as LeftTab) ? (p?.leftTab as LeftTab) : null,
          minimapVisible: typeof p?.minimapVisible === "boolean" ? p.minimapVisible : true,
        };
      },
    },
  ),
);
