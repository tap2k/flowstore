import { create } from "zustand";
import { useSpecStore } from "./spec";

// Tracks whether the in-memory spec has un-saved-to-GitHub edits. Powers the
// header pill, the beforeunload guard, and Cmd+S routing. "Saved" here means
// "successfully committed to GitHub" — local autosave (persistence.ts) is
// crash safety, not the save-state of record.
interface DirtyState {
  isDirty: boolean;
  // ms timestamp of the last successful GitHub-side save, or null if no save
  // has happened in this session yet. The pill uses this to render a
  // human-readable "Saved · 12s ago".
  lastSavedAt: number | null;
  setDirty: (b: boolean) => void;
  // Successful GitHub-side save: clears dirty and stamps the time.
  markSaved: () => void;
}

export const useDirtyStore = create<DirtyState>((set) => ({
  isDirty: false,
  lastSavedAt: null,
  setDirty: (b) => set({ isDirty: b }),
  markSaved: () => set({ isDirty: false, lastSavedAt: Date.now() }),
}));

// Subscribes to spec changes and flips isDirty=true. Caller is responsible
// for starting this AFTER initial hydration so the loadSavedSpec setSpec
// doesn't get counted as a user edit. Returns the unsubscribe.
export function startDirtyTracking(): () => void {
  let prevSpec = useSpecStore.getState().spec;
  return useSpecStore.subscribe((state) => {
    if (state.spec !== prevSpec) {
      prevSpec = state.spec;
      useDirtyStore.getState().setDirty(true);
    }
  });
}
