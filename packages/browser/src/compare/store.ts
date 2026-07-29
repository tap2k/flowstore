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
import { clearTurnAudio, putTurnAudio } from "@/lib/runtime/audioCache";

export type RunMode =
  | { kind: "all" }
  | { kind: "row"; id: string }
  // One cell: the selected scenario on one model column (the header ▶ and
  // the composer's probes both run in this mode).
  | { kind: "cell"; index: number };

// Compare's state and actions, in the editor's store idiom (zustand; the
// page renders, the store owns behavior). Hydrates once from studyStorage at
// module load; the subscription below writes changes back debounced — and
// never mid-run, so a matrix run serializes to localStorage exactly once,
// when it settles.

// Compare is the small-N eyeball tool: three transcript columns is what
// reads side by side. Caps the ADD action only — a bundle that arrives
// wider still opens intact (never destroy imported data).
export const MAX_MODEL_COLUMNS = 3;

// The engine's ResolveDispatch, backed by the shared settings store — and
// the single "is this model dispatchable" predicate (run, translate, and the
// generators all use it rather than respelling the provider/key check).
export function resolveForEngine(model: string) {
  const d = resolveDispatch(model);
  return d.provider && d.apiKey.trim()
    ? { provider: d.provider, apiKey: d.apiKey, baseUrl: d.baseUrl, wireModel: d.wireModel, live: d.live }
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
  // The one in-flight run, or null. A single discriminated field (not three
  // flags) so mutual exclusion, the busy checks, and the persist guard are
  // all `runMode` — and the column-0-is-falsy trap can't exist.
  runMode: RunMode | null;
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
  // Typed user turn into ONE column's conversation (the per-column
  // composer). OFF-SCRIPT by design: the scenario stays the canonical
  // suite; the probe lives in the cell's transcript (and so in the saved
  // study and exported run results). A later scripted re-run of the cell
  // starts over from the script. Returns false when the send was NOT
  // accepted (no scenario selected, or a run raced in) — the composer keeps
  // the draft in that case.
  sendUserTurn: (text: string, mi: number) => Promise<boolean>;
  runCell: (mi: number) => Promise<void>;
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

// Standing state for a partial (row/column) run: paused cells INSIDE the
// rerun scope continue mid-conversation; done cells OUTSIDE it seed the
// engine solely so the divergence pass compares against the standing
// incumbent (the engine skips done seeds, and the scope filter keeps them
// from executing — resumeFrom is the state filter, scenarios/columns the
// execution filter; deliberately independent).
function seedFor(
  cells: Record<string, CellState>,
  rerun: (key: string) => boolean,
): Record<string, CellState> {
  const out: Record<string, CellState> = {};
  for (const [k, c] of Object.entries(cells)) {
    if (rerun(k)) {
      if (c.status === "idle" && c.turns.length > 0) out[k] = c;
    } else if (c.status === "done") {
      out[k] = c;
    }
  }
  return out;
}

export const useCompareStore = create<CompareState>((set, get) => {
  // Shared run plumbing: mutual exclusion, cache policy, the abort handle,
  // the engine call, mode cleanup. The three public actions differ only in
  // scope and seed policy — exactly and only what they pass here.
  const startRun = async (
    mode: RunMode,
    a: {
      scenarios: Scenario[];
      columns?: number[];
      resumeFrom?: Record<string, CellState>;
      keepCaches: (key: string) => boolean;
      patch?: Partial<CompareState>;
    },
  ): Promise<boolean> => {
    if (get().runMode) return false;
    const { prompt, vars, models } = get();
    set((st) => ({ runMode: mode, ...(a.patch ?? {}), ...cellCaches(st, a.keepCaches) }));
    // The engine owns the matrix policy (parallelism, divergence); the store
    // only supplies credentials and mirrors patches into state.
    runAbort = new AbortController();
    await runMatrix({
      systemPrompt: filledPromptOf(prompt, vars),
      scenarios: a.scenarios,
      models,
      resolveDispatch: resolveForEngine,
      onCell: patchCell(set),
      onAudio: putTurnAudio,
      signal: runAbort.signal,
      resumeFrom:
        a.resumeFrom && Object.keys(a.resumeFrom).length > 0 ? a.resumeFrom : undefined,
      columns: a.columns,
    });
    runAbort = null;
    set({ runMode: null });
    return true;
  };

  return ({
  agentId: initial.agentId,
  prompt: initial.prompt,
  scenarios: initial.scenarios,
  models: initial.models.length > 0 ? initial.models : [DEFAULT_MODEL_ID, DEFAULT_MODEL_ID],
  cells: initial.cells,
  selected: initial.scenarios[0]?.id ?? null,
  golds: initial.golds,
  vars: initial.vars,
  github: initial.github,
  runMode: null,
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

  // Removal prunes the removed row's cells — the cells bag must track the
  // grid or counters and exports drift (orphans once made 5/4 possible).
  removeScenario: (i) =>
    set((s) => {
      const sc = s.scenarios[i];
      const cells = Object.fromEntries(
        Object.entries(s.cells).filter(([k]) => !sc || !k.startsWith(`${sc.id}::`)),
      );
      return { scenarios: s.scenarios.filter((_, j) => j !== i), cells };
    }),

  setModelAt: (i, id) =>
    set((s) => ({ models: s.models.map((m, j) => (j === i ? id : m)) })),
  addModel: () =>
    set((s) =>
      s.models.length >= MAX_MODEL_COLUMNS ? s : { models: [...s.models, DEFAULT_MODEL_ID] },
    ),
  // Column removal re-keys: cells are index-keyed, so surviving columns
  // shift down (and captured-gold column pointers shift with them —
  // a gold captured FROM the removed column keeps only its transcript).
  removeModel: (i) =>
    set((s) => {
      const cells: Record<string, CellState> = {};
      for (const [k, c] of Object.entries(s.cells)) {
        const at = k.lastIndexOf("::");
        const mi = Number(k.slice(at + 2));
        if (mi === i) continue;
        cells[cellKey(k.slice(0, at), mi > i ? mi - 1 : mi)] = c;
      }
      const golds = Object.fromEntries(
        Object.entries(s.golds).map(([sid, g]) => [
          sid,
          g.column === undefined || g.column < i
            ? g
            : { ...g, column: g.column === i ? undefined : g.column - 1 },
        ]),
      );
      return {
        models: s.models.filter((_, j) => j !== i),
        cells,
        golds,
        // Translation caches are cellKey-keyed; drop everything at or past
        // the removed index rather than re-keying caches.
        ...cellCaches(s, (k) => Number(k.slice(k.lastIndexOf("::") + 2)) < i),
      };
    }),

  setVar: (name, value) => set((s) => ({ vars: { ...s.vars, [name]: value } })),

  setGithubLocation: (loc) => set({ github: loc }),

  // Drop the transcripts (and their translation caches/toggles/errors) while
  // keeping the study itself — prompt, scenarios, models, golds, vars.
  clearConversations: () => {
    clearTurnAudio();
    set((st) => ({ cells: {}, ...cellCaches(st, () => false) }));
  },

  clearStudy: () => {
    clearTurnAudio();
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
    });
  },

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
    const { scenarios, models, cells } = get();
    // One pass over the matrix: cells with progress (done, or paused with
    // turns) are kept; resume unless nothing has run or everything has.
    const kept: Record<string, CellState> = {};
    let total = 0;
    let done = 0;
    for (const sc of scenarios) {
      for (let mi = 0; mi < models.length; mi++) {
        total++;
        const k = cellKey(sc.id, mi);
        const c = cells[k];
        if (!c) continue;
        if (c.status === "done") done++;
        if (c.status === "done" || c.turns.length > 0) kept[k] = c;
      }
    }
    const resuming = Object.keys(kept).length > 0 && done < total;
    const seed = resuming ? kept : {};
    await startRun(
      { kind: "all" },
      {
        scenarios,
        resumeFrom: resuming ? kept : undefined,
        keepCaches: (k) => k in seed,
        patch: { cells: seed },
      },
    );
  },

  // Run one scenario row across every model column — a single-scenario
  // matrix, so the engine's column parallelism and divergence pass apply
  // unchanged. Same pause semantics as run: a stopped conversation
  // continues; done and errored cells re-run (clicking the row's ▶ IS the
  // explicit re-request). Caches drop only for cells starting over.
  runScenario: async (sc) => {
    const inRow = new Set(get().models.map((_, mi) => cellKey(sc.id, mi)));
    const resume = seedFor(get().cells, (k) => inRow.has(k));
    await startRun(
      { kind: "row", id: sc.id },
      {
        scenarios: [sc],
        resumeFrom: resume,
        keepCaches: (k) => !inRow.has(k) || k in resume,
        patch: { selected: sc.id },
      },
    );
  },

  sendUserTurn: async (text, mi) => {
    const t = text.trim();
    const { selected, scenarios, cells, runMode } = get();
    const sc = scenarios.find((x) => x.id === selected);
    if (!t || !sc || runMode) return false;
    const key = cellKey(sc.id, mi);
    // A synthetic script — this cell's own user turns plus the probe — lets
    // the ordinary resume machinery continue the conversation while the
    // scenario stays untouched. Text cells resume in place (done AND
    // cleanly-errored cells flip to idle: complete pairs are a valid prefix
    // of the probe script — the error text was already surfaced). s2s cells
    // replay the whole conversation in a fresh session (a closed live
    // socket can't be re-seeded), which costs another run but stays honest.
    const userTurns = (cells[key]?.turns ?? [])
      .filter((x) => x.role === "user")
      .map((x) => x.text);
    const probe: Scenario = { ...sc, turns: [...userTurns, t] };
    set((st) => {
      const c = st.cells[key];
      const completePairs = !!c && c.turns.length > 0 && c.turns.length % 2 === 0;
      return (c?.status === "done" || c?.status === "error") && completePairs
        ? { cells: { ...st.cells, [key]: { ...c, status: "idle", error: undefined } } }
        : {};
    });
    const resume = seedFor(get().cells, (k) => k === key);
    return startRun(
      { kind: "cell", index: mi },
      {
        scenarios: [probe],
        columns: [mi],
        resumeFrom: resume,
        keepCaches: (k) => k !== key || k in resume,
      },
    );
  },

  // Run ONE cell: the selected scenario on this model column — the header ▶
  // lives next to the transcript it would rerun, so it means "run this
  // conversation", not a column sweep. Same pause semantics as runScenario.
  // (Whole-matrix and whole-row sweeps stay: run-all and the sidebar ▶.)
  runCell: async (mi) => {
    const { selected, scenarios } = get();
    const sc = scenarios.find((x) => x.id === selected);
    if (!sc) return;
    const key = cellKey(sc.id, mi);
    const resume = seedFor(get().cells, (k) => k === key);
    await startRun(
      { kind: "cell", index: mi },
      {
        scenarios: [sc],
        columns: [mi],
        resumeFrom: resume,
        keepCaches: (k) => k !== key || k in resume,
      },
    );
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
    window.location.href = "/create/?study=compare";
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
});
});

// The per-cell translation caches/toggles/errors, filtered to the keys the
// predicate keeps — the one spelling of "drop caches for cells that re-run"
// shared by clearConversations, run, and runScenario.
function cellCaches(st: CompareState, keep: (key: string) => boolean) {
  const f = <T,>(rec: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(rec).filter(([k]) => keep(k)));
  return {
    translations: f(st.translations),
    showTranslated: f(st.showTranslated),
    translateErrors: f(st.translateErrors),
  };
}

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
  if (s.runMode) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushStudy, 300);
});
