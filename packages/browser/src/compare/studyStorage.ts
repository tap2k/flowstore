import { createScopedJsonStorage, isPlainObject } from "@/lib/store/scopedStorage";
import { genId } from "@flowstore/core/ids";
import type { CapturedGold, CellState, Scenario } from "@flowstore/studies";

// Compare's study state survives refresh the same way the editor's panel
// state does: the shared scoped-storage module, one JSON payload per key.
// One study slot for now ("current") — localStorage serves only the casual
// tier; real continuity is the exported bundle / the study repo.

// A study gold: the engine's CapturedGold plus which column it was captured
// from this session (absent for golds that arrived via import).
export type StudyGold = CapturedGold & { column?: number };

// Which repo the study was opened from / last saved to. Local artifacts
// (upload, example) carry no repo claim, mirroring the editor's rule.
export type StudyGithubLocation = { owner: string; repo: string; ref: string };

export type PersistedStudy = {
  // Stable per-study agent id, kept for the study's life — the editor scopes
  // canvas positions and persona buckets by it after graduation. Always
  // present: minted here at the storage boundary (fresh and legacy payloads
  // alike), so no downstream consumer handles its absence.
  agentId: string;
  prompt: string;
  scenarios: Scenario[];
  models: string[];
  cells: Record<string, CellState>;
  golds: Record<string, StudyGold>;
  // Placeholder-fill values for the prompt's {{vars}} (fixture bag — the
  // prompt text itself is never rewritten).
  vars: Record<string, string>;
  github: StudyGithubLocation | null;
  // The FileMap the study was opened from (GitHub open, upload, example) —
  // null for pasted-prompt studies. Graduation and re-export overlay the
  // study onto these files so a source project's flows survive the round
  // trip (see buildStudyBundle's sourceFiles).
  sourceFiles: Record<string, string> | null;
};

export const EMPTY_STUDY: Omit<PersistedStudy, "agentId"> = {
  prompt: "",
  scenarios: [],
  models: [],
  cells: {},
  golds: {},
  vars: {},
  github: null,
  sourceFiles: null,
};

export const freshStudy = (): PersistedStudy => ({ agentId: genId("agent"), ...EMPTY_STUDY });

// One "study has nothing to run or graduate" predicate, shared by the send
// side (ComparePage's open-in-editor gating) and the receive side (the
// editor's handoff drain) so they can't drift. Distinct from the storage
// isEmpty below, which decides persistence-worthiness.
export const isStudyEmpty = (s: Pick<PersistedStudy, "prompt" | "scenarios">): boolean =>
  !s.prompt.trim() && s.scenarios.length === 0;

const storage = createScopedJsonStorage<PersistedStudy>({
  prefix: "flowstore:compare:study:",
  defaultValue: freshStudy,
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
      agentId: typeof raw.agentId === "string" && raw.agentId ? raw.agentId : genId("agent"),
      prompt: raw.prompt,
      scenarios: raw.scenarios as Scenario[],
      models: (raw.models as string[]).filter((m) => typeof m === "string"),
      cells,
      golds: isPlainObject(raw.golds) ? (raw.golds as PersistedStudy["golds"]) : {},
      vars: isPlainObject(raw.vars)
        ? Object.fromEntries(
            Object.entries(raw.vars).filter(([, v]) => typeof v === "string"),
          ) as Record<string, string>
        : {},
      github:
        isPlainObject(raw.github) &&
        typeof raw.github.owner === "string" &&
        typeof raw.github.repo === "string" &&
        typeof raw.github.ref === "string"
          ? { owner: raw.github.owner, repo: raw.github.repo, ref: raw.github.ref }
          : null,
      sourceFiles: isPlainObject(raw.sourceFiles)
        ? (Object.fromEntries(
            Object.entries(raw.sourceFiles).filter(([, v]) => typeof v === "string"),
          ) as Record<string, string>)
        : null,
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
