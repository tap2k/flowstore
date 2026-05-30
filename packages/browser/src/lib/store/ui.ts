import { create } from "zustand";
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
  // surfaces. Tab state is panel-local (not URL-routed) — closing and
  // reopening Run resets to simulate.
  openSimulateTab: "simulate" | "tests" | "personas" | "golds";
  setOpenSimulateTab: (
    tab: "simulate" | "tests" | "personas" | "golds",
  ) => void;
}

export const useUiStore = create<UiState>((set) => ({
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
}));
