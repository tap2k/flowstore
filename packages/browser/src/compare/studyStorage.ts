import { createScopedJsonStorage, isPlainObject } from "@/lib/store/scopedStorage";
import type { CapturedGold, CellState, Scenario } from "@flowstore/studies";

// Compare's study state survives refresh the same way the editor's panel
// state does: the shared scoped-storage module, one JSON payload per key.
// One study slot for now ("current") — localStorage serves only the casual
// tier; real continuity is the exported bundle / the study repo.

export type PersistedStudy = {
  prompt: string;
  scenarios: Scenario[];
  models: string[];
  cells: Record<string, CellState>;
  monthly: number;
  golds: Record<string, CapturedGold & { column?: number }>;
  // Placeholder-fill values for the prompt's {{vars}} (fixture bag — the
  // prompt text itself is never rewritten).
  vars: Record<string, string>;
};

export const EMPTY_STUDY: PersistedStudy = {
  prompt: "",
  scenarios: [],
  models: [],
  cells: {},
  monthly: 30000,
  golds: {},
  vars: {},
};

const storage = createScopedJsonStorage<PersistedStudy>({
  prefix: "flowstore:compare:study:",
  defaultValue: () => EMPTY_STUDY,
  validate: (raw) => {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.prompt !== "string") return null;
    if (!Array.isArray(raw.scenarios) || !Array.isArray(raw.models)) return null;
    if (!isPlainObject(raw.cells)) return null;
    const cells: Record<string, CellState> = {};
    for (const [k, v] of Object.entries(raw.cells as Record<string, CellState>)) {
      // A run that was mid-flight at reload can't resume — its cells go back
      // to idle rather than showing a spinner forever.
      cells[k] = v.status === "running" ? { ...v, status: "idle" } : v;
    }
    return {
      prompt: raw.prompt,
      scenarios: raw.scenarios as Scenario[],
      models: (raw.models as string[]).filter((m) => typeof m === "string"),
      cells,
      monthly: typeof raw.monthly === "number" ? raw.monthly : 30000,
      golds: isPlainObject(raw.golds) ? (raw.golds as PersistedStudy["golds"]) : {},
      vars: isPlainObject(raw.vars)
        ? Object.fromEntries(
            Object.entries(raw.vars).filter(([, v]) => typeof v === "string"),
          ) as Record<string, string>
        : {},
    };
  },
  isEmpty: (v) =>
    !v.prompt &&
    v.scenarios.length === 0 &&
    Object.keys(v.cells).length === 0 &&
    Object.keys(v.golds).length === 0 &&
    Object.keys(v.vars).length === 0,
});

const STUDY_ID = "current";

export const loadStudy = (): PersistedStudy => storage.load(STUDY_ID);
export const saveStudy = (study: PersistedStudy): void => storage.save(STUDY_ID, study);
