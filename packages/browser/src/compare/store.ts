import { create } from "zustand";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import { genId } from "@flowstore/core/ids";
import { substituteVars } from "@flowstore/core/codegen/promptGenerator";
import { translateBatch } from "@flowstore/core/runtime/translate";
import {
  IDLE_CELL,
  cellKey,
  detectPlaceholders,
  generateScenarios,
  generateVars,
  parseStudyBundle,
  runMatrix,
} from "@flowstore/studies";
import type { CellState, Scenario } from "@flowstore/studies";
import { DEFAULT_MODEL_ID, resolveDispatch } from "@/lib/store/settings";
import { useSettingsStore } from "@/lib/store/settings";
import {
  loadStudy,
  saveStudy,
  type StudyGithubLocation,
  type StudyGold,
} from "./studyStorage";

// Compare's state and actions, in the editor's store idiom (zustand; the
// page renders, the store owns behavior). Hydrates once from studyStorage at
// module load; the subscription below writes changes back debounced — and
// never mid-run, so a matrix run serializes to localStorage exactly once,
// when it settles.

// The engine's ResolveDispatch, backed by the shared settings store — and
// the single "is this model dispatchable" predicate (run, translate, and the
// generators all use it rather than respelling the provider/key check).
export function resolveForEngine(model: string) {
  const d = resolveDispatch(model);
  return d.provider && d.apiKey.trim()
    ? { provider: d.provider, apiKey: d.apiKey, baseUrl: d.baseUrl, wireModel: d.wireModel }
    : null;
}

// Placeholder-fill: only currently-detected, non-empty values participate —
// stale entries for placeholders no longer in the prompt neither fill nor
// export. The pasted prompt is never rewritten; the fill is a session-compile
// bag applied at send time (the promptGenerator override semantics).
export function activeVarsOf(prompt: string, vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of detectPlaceholders(prompt)) {
    const v = vars[n];
    if (v?.trim()) out[n] = v;
  }
  return out;
}

export function filledPromptOf(prompt: string, vars: Record<string, string>): string {
  const active = activeVarsOf(prompt, vars);
  return Object.keys(active).length > 0 ? substituteVars(prompt, active) : prompt;
}

interface CompareState {
  // Stable per-study agent id (see studyStorage) — minted here, re-minted on
  // clear, adopted from agent.json on bundle open.
  agentId: string;
  prompt: string;
  scenarios: Scenario[];
  models: string[];
  cells: Record<string, CellState>;
  selected: string | null;
  // One gold per scenario id (StudyGold: column = captured-from this
  // session; absent = imported).
  golds: Record<string, StudyGold>;
  vars: Record<string, string>;
  // Repo the study came from / last landed in; null = local-only study.
  github: StudyGithubLocation | null;
  running: boolean;
  // Scenario id of an in-flight single-row run (the sidebar ▶); mutually
  // exclusive with a full run.
  rowRunning: string | null;
  setupOpen: boolean;
  generatingVars: boolean;
  generateVarsError: string | null;
  generatingScenarios: boolean;
  generateScenariosError: string | null;
  // Per-column translate, mirroring the editor's SimulatePanel: manual
  // trigger, one batched call over uncached turns (cached by turn ts),
  // toggle swaps the bubble text to English.
  translations: Record<string, Map<number, string>>;
  showTranslated: Record<string, boolean>;
  translating: string | null;
  translateErrors: Record<string, string>;

  setPrompt: (prompt: string) => void;
  setSelected: (id: string | null) => void;
  setSetupOpen: (open: boolean) => void;
  addScenario: () => void;
  updateScenario: (i: number, patch: Partial<Scenario>) => void;
  removeScenario: (i: number) => void;
  setModelAt: (i: number, id: string) => void;
  addModel: () => void;
  removeModel: (i: number) => void;
  setVar: (name: string, value: string) => void;
  setGithubLocation: (loc: StudyGithubLocation | null) => void;
  clearConversations: () => void;
  clearStudy: () => void;
  applyBundle: (files: Record<string, string>) => void;
  loadExample: () => Promise<void>;
  uploadBundle: (file: File) => void;
  run: () => Promise<void>;
  runScenario: (s: Scenario) => Promise<void>;
  stopRun: () => void;
  translateColumn: (key: string, turns: TranscriptTurn[]) => Promise<void>;
  generateVars: () => Promise<void>;
  generateScenarios: () => Promise<void>;
  openInEditor: () => void;
  captureGold: (scenarioId: string, column: number) => void;
}

const initial = loadStudy();

// Abort handle for the in-flight run (full matrix or single row — they're
// mutually exclusive). Module-level, not state: an AbortController isn't
// serializable and no view renders it.
let runAbort: AbortController | null = null;

export const useCompareStore = create<CompareState>((set, get) => ({
  agentId: initial.agentId,
  prompt: initial.prompt,
  scenarios: initial.scenarios,
  models: initial.models.length > 0 ? initial.models : [DEFAULT_MODEL_ID, DEFAULT_MODEL_ID],
  cells: initial.cells,
  selected: initial.scenarios[0]?.id ?? null,
  golds: initial.golds,
  vars: initial.vars,
  github: initial.github,
  running: false,
  rowRunning: null,
  setupOpen: true,
  generatingVars: false,
  generateVarsError: null,
  generatingScenarios: false,
  generateScenariosError: null,
  translations: {},
  showTranslated: {},
  translating: null,
  translateErrors: {},

  setPrompt: (prompt) => set({ prompt }),
  setSelected: (selected) => set({ selected }),
  setSetupOpen: (setupOpen) => set({ setupOpen }),

  addScenario: () => {
    const id = genId("scenario");
    set((s) => ({
      scenarios: [
        {
          id,
          scenarioId: id,
          name: `Scenario ${s.scenarios.length + 1}`,
          language: "EN",
          turns: [""],
        },
        ...s.scenarios,
      ],
      selected: s.selected ?? id,
    }));
  },

  updateScenario: (i, patch) =>
    set((s) => ({
      scenarios: s.scenarios.map((sc, j) => (j === i ? { ...sc, ...patch } : sc)),
    })),

  removeScenario: (i) =>
    set((s) => ({ scenarios: s.scenarios.filter((_, j) => j !== i) })),

  setModelAt: (i, id) =>
    set((s) => ({ models: s.models.map((m, j) => (j === i ? id : m)) })),
  addModel: () => set((s) => ({ models: [...s.models, DEFAULT_MODEL_ID] })),
  removeModel: (i) => set((s) => ({ models: s.models.filter((_, j) => j !== i) })),

  setVar: (name, value) => set((s) => ({ vars: { ...s.vars, [name]: value } })),

  setGithubLocation: (loc) => set({ github: loc }),

  // Drop the transcripts (and their translation caches/toggles/errors) while
  // keeping the study itself — prompt, scenarios, models, golds, vars.
  clearConversations: () =>
    set({ cells: {}, translations: {}, showTranslated: {}, translateErrors: {} }),

  clearStudy: () =>
    set({
      agentId: genId("agent"),
      prompt: "",
      scenarios: [],
      models: [DEFAULT_MODEL_ID, DEFAULT_MODEL_ID],
      cells: {},
      golds: {},
      vars: {},
      github: null,
      translations: {},
      showTranslated: {},
      translateErrors: {},
      selected: null,
      setupOpen: true,
    }),

  applyBundle: (files) => {
    // Parsing (scenarios from cases or golds, gold rebinding, fixture vars)
    // lives beside buildStudyBundle in @flowstore/studies — the store only
    // maps the parsed study into state.
    const parsed = parseStudyBundle(files);
    set({
      agentId: parsed.agentId ?? genId("agent"),
      prompt: parsed.prompt,
      scenarios: parsed.scenarios,
      golds: parsed.golds,
      vars: parsed.vars,
      // A bundle has no repo claim (the GitHub open flow re-stamps the
      // location right after this — see ComparePage's onOpened wiring).
      github: null,
      cells: {},
      translations: {},
      showTranslated: {},
      translateErrors: {},
      selected: parsed.scenarios[0]?.id ?? null,
      setupOpen: true,
    });
  },

  // The dead-start rescue: a bundled example file (same .flowstore.json the
  // repo ships as its single-file form). Local static asset — no GitHub
  // semantics; PAT users load real projects instead.
  loadExample: async () => {
    const files = (await (
      await fetch("/examples/clinic.flowstore.json")
    ).json()) as Record<string, string>;
    get().applyBundle(files);
  },

  uploadBundle: (file) => {
    void file
      .text()
      .then((text) => get().applyBundle(JSON.parse(text) as Record<string, string>));
  },

  // Run = pick up where things stand: done conversations are kept and
  // skipped, stopped ones continue mid-conversation (engine-validated
  // against the current script), errored/missing ones run fresh. A
  // fully-done or untouched matrix runs from scratch; an explicit fresh
  // start over partial results is the clear button.
  run: async () => {
    const { prompt, vars, scenarios, models, cells } = get();
    const keys = scenarios.flatMap((sc) => models.map((_, mi) => cellKey(sc.id, mi)));
    const progressed = keys.filter((k) => {
      const c = cells[k];
      return !!c && (c.status === "done" || c.turns.length > 0);
    });
    const doneCount = keys.filter((k) => cells[k]?.status === "done").length;
    const resuming = progressed.length > 0 && doneCount < keys.length;
    const kept = Object.fromEntries(progressed.map((k) => [k, cells[k]]));
    // Kept conversations keep their translation caches/toggles; everything
    // about to re-run drops them so new turns can't show stale glosses.
    const keepKept = <T,>(rec: Record<string, T>): Record<string, T> =>
      resuming ? Object.fromEntries(Object.entries(rec).filter(([k]) => k in kept)) : {};
    set((st) => ({
      running: true,
      cells: resuming ? kept : {},
      translations: keepKept(st.translations),
      showTranslated: keepKept(st.showTranslated),
      translateErrors: keepKept(st.translateErrors),
    }));
    // The engine owns the matrix policy (parallelism, divergence); the store
    // only supplies credentials and mirrors patches into state.
    runAbort = new AbortController();
    await runMatrix({
      systemPrompt: filledPromptOf(prompt, vars),
      scenarios,
      models,
      resolveDispatch: resolveForEngine,
      onCell: patchCell(set),
      signal: runAbort.signal,
      resumeFrom: resuming ? kept : undefined,
    });
    runAbort = null;
    set({ running: false });
  },

  // Run one scenario row across every model column — a single-scenario
  // matrix, so the engine's column parallelism and divergence pass apply
  // unchanged. Same pause semantics as run: a stopped conversation
  // continues; done and errored cells re-run (clicking the row's ▶ IS the
  // explicit re-request). Caches drop only for cells starting over.
  runScenario: async (sc) => {
    const { running, rowRunning, prompt, vars, models, cells } = get();
    if (running || rowRunning) return;
    const rowKeys = models.map((_, mi) => cellKey(sc.id, mi));
    const resume: Record<string, CellState> = {};
    for (const k of rowKeys) {
      const c = cells[k];
      if (c && c.status === "idle" && c.turns.length > 0) resume[k] = c;
    }
    const dropRestarting = <T,>(rec: Record<string, T>): Record<string, T> => {
      const next = { ...rec };
      for (const k of rowKeys) if (!(k in resume)) delete next[k];
      return next;
    };
    set((s) => ({
      rowRunning: sc.id,
      selected: sc.id,
      translations: dropRestarting(s.translations),
      showTranslated: dropRestarting(s.showTranslated),
      translateErrors: dropRestarting(s.translateErrors),
    }));
    runAbort = new AbortController();
    await runMatrix({
      systemPrompt: filledPromptOf(prompt, vars),
      scenarios: [sc],
      models,
      resolveDispatch: resolveForEngine,
      onCell: patchCell(set),
      signal: runAbort.signal,
      resumeFrom: Object.keys(resume).length > 0 ? resume : undefined,
    });
    runAbort = null;
    set({ rowRunning: null });
  },

  // Cooperative stop: the engine checks at turn boundaries, drops the
  // in-flight result, and reverts unfinished cells to idle.
  stopRun: () => runAbort?.abort(),

  // Translate one column's conversation (or toggle back to originals when
  // everything is already cached). Same semantics as the editor's
  // onTranslate; runs on the default model via whatever dispatch resolves.
  translateColumn: async (key, turns) => {
    const { translating, translations, showTranslated } = get();
    if (translating) return;
    const cache = translations[key];
    const uncached = turns.filter((t) => t.text && !cache?.has(t.ts));
    if (uncached.length === 0 && showTranslated[key]) {
      set((s) => ({ showTranslated: { ...s.showTranslated, [key]: false } }));
      return;
    }
    const dispatch = resolveForEngine(useSettingsStore.getState().defaultModel);
    if (!dispatch) return; // button is gated on this
    set((s) => ({ translating: key, translateErrors: { ...s.translateErrors, [key]: "" } }));
    try {
      if (uncached.length > 0) {
        const result = await translateBatch(
          uncached.map((t) => ({ id: String(t.ts), text: t.text })),
          dispatch,
        );
        set((s) => {
          const m = new Map(s.translations[key] ?? []);
          for (const [id, eng] of Object.entries(result)) m.set(Number(id), eng);
          return { translations: { ...s.translations, [key]: m } };
        });
      }
      set((s) => ({ showTranslated: { ...s.showTranslated, [key]: true } }));
    } catch (e) {
      set((s) => ({
        translateErrors: {
          ...s.translateErrors,
          [key]: e instanceof Error ? e.message : String(e),
        },
      }));
    } finally {
      set({ translating: null });
    }
  },

  // Machine-assist on the TEST side only: the LLM proposes fill values, the
  // user edits them before any run touches a model. Runs on the DEFAULT
  // model, like every assist (translate, watcher, generators) — the
  // incumbent is the system under test, never the tooling.
  generateVars: async () => {
    const { prompt, vars } = get();
    const names = detectPlaceholders(prompt).filter((n) => !(vars[n] ?? "").trim());
    if (names.length === 0) return;
    const d = resolveForEngine(useSettingsStore.getState().defaultModel);
    if (!d) {
      set({ generateVarsError: "Generating values needs an API key for the default model (settings)." });
      return;
    }
    set({ generatingVars: true, generateVarsError: null });
    try {
      const bag = await generateVars(prompt, names, d);
      set((s) => ({ vars: { ...s.vars, ...bag } }));
    } catch (e) {
      set({ generateVarsError: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ generatingVars: false });
    }
  },

  // Draft scenarios from the placeholder-filled prompt, grounded on the
  // existing list so new ones cover different paths. Appends (addScenario
  // prepends — generated rows read as "more", not "first").
  generateScenarios: async () => {
    const { prompt, vars, scenarios } = get();
    if (!prompt.trim()) return;
    const d = resolveForEngine(useSettingsStore.getState().defaultModel);
    if (!d) {
      set({
        generateScenariosError:
          "Generating scenarios needs an API key for the default model (settings).",
      });
      return;
    }
    set({ generatingScenarios: true, generateScenariosError: null });
    try {
      const fresh = await generateScenarios(filledPromptOf(prompt, vars), scenarios, d);
      set((s) => ({
        scenarios: [...s.scenarios, ...fresh],
        selected: s.selected ?? fresh[0]?.id ?? null,
      }));
    } catch (e) {
      set({ generateScenariosError: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ generatingScenarios: false });
    }
  },

  // Graduation: land this study in the editor at "/" (same origin, same
  // localStorage). Flushes the pending save first — navigation would kill the
  // debounce timer — then navigates with the flag the editor's boot drain
  // (lib/compareHandoff.ts) looks for.
  openInEditor: () => {
    flushStudy();
    window.location.href = "/?study=compare";
  },

  captureGold: (scenarioId, column) => {
    const { scenarios, cells } = get();
    const sc = scenarios.find((x) => x.id === scenarioId);
    const c = cells[cellKey(scenarioId, column)];
    if (!sc || !c) return;
    set((s) => ({
      golds: {
        ...s.golds,
        [scenarioId]: {
          scenarioId: sc.scenarioId,
          language: sc.language,
          name: sc.name,
          column,
          turns: c.turns.map((t) => ({ role: t.role, text: t.text })),
        },
      },
    }));
  },
}));

function patchCell(set: (fn: (s: CompareState) => Partial<CompareState>) => void) {
  return (key: string, patch: Partial<CellState>) =>
    set((s) => ({ cells: { ...s.cells, [key]: { ...(s.cells[key] ?? IDLE_CELL), ...patch } } }));
}

// Persist the study — debounced, and never mid-run: every cell patch touches
// `cells`, and serializing all transcripts to localStorage dozens of times
// during a matrix run is pure waste. The run's settling state change fires
// the one save that matters. flushStudy is the single snapshot-and-save,
// shared with openInEditor's pre-navigation flush.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function flushStudy() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const { agentId, prompt, scenarios, models, cells, golds, vars, github } =
    useCompareStore.getState();
  saveStudy({ agentId, prompt, scenarios, models, cells, golds, vars, github });
}
useCompareStore.subscribe((s) => {
  if (s.running || s.rowRunning !== null) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushStudy, 300);
});
