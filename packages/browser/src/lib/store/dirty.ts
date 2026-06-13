import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { debouncedLocalStorage } from "./scopedStorage";
import { useSpecStore } from "./spec";
import { useTestsStore } from "./tests";
import { decomposeSpec, decomposeTestingArtifacts } from "@flowstore/core/files";

// Tracks whether the in-memory project has edits not yet committed to GitHub.
// Powers the header pill, the beforeunload guard, and Cmd+S routing. "Saved"
// here means "successfully committed to GitHub" — the spec/tests stores'
// localStorage autosave (persist middleware) is crash safety, not the
// save-state of record.
//
// ── How dirtiness is derived (first principles) ──────────────────────────────
// isDirty is a function of the SAVE PAYLOAD, not of which mutator ran. The
// payload is exactly what every Save writes:
//   { ...decomposeSpec(spec), ...decomposeTestingArtifacts(tests) }
// We keep a signature of that payload as of the last load/save (`baselineSig`)
// and consider the project dirty iff the current payload signature differs.
//
// Invariant we guarantee: isDirty is NEVER a false negative. Any change that
// alters a saved file flips the bit — including edits made by mutators nobody
// remembered to annotate, because we observe the stores, not the call sites.
// False positives are acceptable (the diff modal corrects them); false
// negatives — pill off while a real unsaved change exists — are the bug class
// this design eliminates.
//
// ── Cost ─────────────────────────────────────────────────────────────────────
// The per-edit concern is decompose() overhead. We sidestep it: while already
// dirty, a store change does NOTHING (it can't make us "more dirty"), so the
// common case — typing into an already-dirty project — runs zero decompose.
// The signature is computed only on a transition off a clean baseline, i.e.
// the FIRST edit after a load/save. Cost is one decompose per dirty-cycle, not
// per keystroke. The trade: a mid-session round-trip back to the saved state
// (add-then-delete) does NOT auto-clear the pill until the next save — that's a
// false positive, which the invariant explicitly permits.
//
// ── Reload ───────────────────────────────────────────────────────────────────
// isDirty and baselineSig are persisted alongside the spec/tests blobs, so a
// page reload restores the true save-state: a project with unsaved-but-
// persisted edits still shows "unsaved" rather than falsely reading "saved"
// until the next keystroke.
interface DirtyState {
  isDirty: boolean;
  // ms timestamp of the last successful GitHub-side save, or null if no save
  // has happened in this session yet. The pill uses this to render a
  // human-readable "Saved · 12s ago".
  lastSavedAt: number | null;
  // Signature of the save payload as of the last load/save. null = unknown
  // baseline (fresh store, no project) — treated as clean until an edit drifts.
  baselineSig: string | null;
  setDirty: (b: boolean) => void;
  // Successful GitHub-side save: re-baselines to the current payload, clears
  // dirty, and stamps the time so subsequent edits measure against what we
  // just wrote.
  markSaved: () => void;
}

export const useDirtyStore = create<DirtyState>()(
  persist(
    (set) => ({
      isDirty: false,
      lastSavedAt: null,
      baselineSig: null,
      setDirty: (b) => set({ isDirty: b }),
      markSaved: () => set({ baselineSig: currentSig(), isDirty: false, lastSavedAt: Date.now() }),
    }),
    {
      name: "flowstore:dirty",
      storage: createJSONStorage(() => debouncedLocalStorage()),
      // lastSavedAt is session-relative ("12s ago"); persisting a stale stamp
      // across a reload would read wrong, so only the save-state of record
      // (isDirty + its baseline) survives.
      partialize: (s) => ({ isDirty: s.isDirty, baselineSig: s.baselineSig }),
    },
  ),
);

// Build the exact FileMap a Save would write, then sign it. Stable across key
// order (FileMap keys sorted) so signature equality means a byte-identical
// save. JSON of [path, content] pairs — cheap, allocation-light, exact (no
// hashing; string compare is fine for a few KB).
function currentSig(): string {
  const spec = useSpecStore.getState().spec;
  // No spec → no project to save; the empty payload is its own baseline.
  const files = spec
    ? { ...decomposeSpec(spec), ...decomposeTestingArtifacts(useTestsStore.getState().toTestingArtifacts()) }
    : {};
  const keys = Object.keys(files).sort();
  return JSON.stringify(keys.map((k) => [k, files[k]]));
}

// Re-baseline to the current payload and clear dirty. Call at every point where
// the in-memory project becomes equal to what's on GitHub: project open and
// refresh. (Save goes through markSaved, which also re-baselines.) After this,
// the next real edit flips dirty; a no-op edit sequence that returns here stays
// clean.
export function markProjectBaseline(): void {
  useDirtyStore.setState({ baselineSig: currentSig(), isDirty: false });
}

// Subscribes to the two stores that feed the save payload (spec + tests) and
// flips isDirty=true on the first change that drifts off the baseline. Safe to
// start on mount: the stores rehydrate from localStorage at creation time
// (persist middleware) before any subscriber attaches, and isDirty/baselineSig
// rehydrate too — so a persisted-dirty project is already dirty here and the
// zero-cost early return holds. Returns a single unsubscribe that tears down
// both subscriptions.
export function startDirtyTracking(): () => void {
  const onChange = () => {
    // Already dirty → nothing to compute; a change can't un-dirty us here
    // (only a save/baseline can). This is the zero-cost typing path.
    if (useDirtyStore.getState().isDirty) return;
    if (currentSig() !== useDirtyStore.getState().baselineSig) {
      useDirtyStore.getState().setDirty(true);
    }
  };
  const unsubSpec = useSpecStore.subscribe(onChange);
  const unsubTests = useTestsStore.subscribe(onChange);
  return () => {
    unsubSpec();
    unsubTests();
  };
}
