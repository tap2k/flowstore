import { create } from "zustand";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import { genId } from "@flowstore/core/ids";
import { substituteVars } from "@flowstore/core/codegen/promptGenerator";
import { generateStructuredJson } from "@flowstore/core/runtime/structuredOutput";
import { translateBatch } from "@flowstore/core/runtime/translate";
import {
  IDLE_CELL,
  cellKey,
  detectPlaceholders,
  parseStudyBundle,
  runMatrix,
} from "@flowstore/studies";
import type { CellState, Scenario } from "@flowstore/studies";
import { DEFAULT_MODEL_ID, resolveDispatch } from "@/lib/store/settings";
import { useSettingsStore } from "@/lib/store/settings";
import { loadStudy, saveStudy, type StudyGold } from "./studyStorage";

// Compare's state and actions, in the editor's store idiom (zustand; the
// page renders, the store owns behavior). Hydrates once from studyStorage at
// module load; the subscription below writes changes back debounced — and
// never mid-run, so a matrix run serializes to localStorage exactly once,
// when it settles.

// The engine's ResolveDispatch, backed by the shared settings store — and
// the single "is this model dispatchable" predicate (run, translate, and
// suggest all use it rather than respelling the provider/key check).
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
  prompt: string;
  scenarios: Scenario[];
  models: string[];
  cells: Record<string, CellState>;
  selected: string | null;
  // One gold per scenario id (StudyGold: column = captured-from this
  // session; absent = imported).
  golds: Record<string, StudyGold>;
  vars: Record<string, string>;
  running: boolean;
  // Scenario id of an in-flight single-row run (the sidebar ▶); mutually
  // exclusive with a full run.
  rowRunning: string | null;
  setupOpen: boolean;
  suggesting: boolean;
  suggestError: string | null;
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
  clearStudy: () => void;
  applyBundle: (files: Record<string, string>) => void;
  loadExample: () => Promise<void>;
  uploadBundle: (file: File) => void;
  run: () => Promise<void>;
  runScenario: (s: Scenario) => Promise<void>;
  translateColumn: (key: string, turns: TranscriptTurn[]) => Promise<void>;
  suggestVars: () => Promise<void>;
  captureGold: (scenarioId: string, column: number) => void;
}

const initial = loadStudy();

export const useCompareStore = create<CompareState>((set, get) => ({
  prompt: initial.prompt,
  scenarios: initial.scenarios,
  models: initial.models.length > 0 ? initial.models : [DEFAULT_MODEL_ID, DEFAULT_MODEL_ID],
  cells: initial.cells,
  selected: initial.scenarios[0]?.id ?? null,
  golds: initial.golds,
  vars: initial.vars,
  running: false,
  rowRunning: null,
  setupOpen: true,
  suggesting: false,
  suggestError: null,
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

  clearStudy: () =>
    set({
      prompt: "",
      scenarios: [],
      models: [DEFAULT_MODEL_ID, DEFAULT_MODEL_ID],
      cells: {},
      golds: {},
      vars: {},
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
      prompt: parsed.prompt,
      scenarios: parsed.scenarios,
      golds: parsed.golds,
      vars: parsed.vars,
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

  run: async () => {
    const { prompt, vars, scenarios, models } = get();
    set({
      running: true,
      cells: {},
      // Fresh transcripts: drop the old translation cache and toggles.
      translations: {},
      showTranslated: {},
      translateErrors: {},
    });
    // The engine owns the matrix policy (parallelism, divergence); the store
    // only supplies credentials and mirrors patches into state.
    await runMatrix({
      systemPrompt: filledPromptOf(prompt, vars),
      scenarios,
      models,
      resolveDispatch: resolveForEngine,
      onCell: patchCell(set),
    });
    set({ running: false });
  },

  // Run one scenario row across every model column — a single-scenario
  // matrix, so the engine's column parallelism and divergence pass apply
  // unchanged.
  runScenario: async (sc) => {
    const { running, rowRunning, prompt, vars, models } = get();
    if (running || rowRunning) return;
    // Fresh transcripts for this row: drop its translation cache, toggles,
    // and errors so the columns can't show stale glosses over new turns.
    const dropRow = <T,>(rec: Record<string, T>): Record<string, T> => {
      const next = { ...rec };
      for (let mi = 0; mi < models.length; mi++) delete next[cellKey(sc.id, mi)];
      return next;
    };
    set((s) => ({
      rowRunning: sc.id,
      selected: sc.id,
      translations: dropRow(s.translations),
      showTranslated: dropRow(s.showTranslated),
      translateErrors: dropRow(s.translateErrors),
    }));
    await runMatrix({
      systemPrompt: filledPromptOf(prompt, vars),
      scenarios: [sc],
      models,
      resolveDispatch: resolveForEngine,
      onCell: patchCell(set),
    });
    set({ rowRunning: null });
  },

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
  // user edits them before any run touches a model. Rides the shared
  // structured-output dispatch on the incumbent model.
  suggestVars: async () => {
    const { prompt, vars, models } = get();
    const names = detectPlaceholders(prompt).filter((n) => !(vars[n] ?? "").trim());
    if (names.length === 0) return;
    const d = resolveForEngine(models[0]);
    if (!d) {
      set({ suggestError: "Suggesting values needs an API key for your current model (settings)." });
      return;
    }
    set({ suggesting: true, suggestError: null });
    try {
      const bag = await generateStructuredJson<Record<string, string>>(
        d.provider,
        d.apiKey,
        d.wireModel,
        {
          baseUrl: d.baseUrl,
          systemPrompt:
            "You suggest plausible sample values for template variables in a conversational agent's system prompt, so the prompt can be test-run. Values are short strings.",
          userPrompt: `Variables: ${names.join(", ")}\n\nSystem prompt:\n${prompt.slice(0, 8000)}`,
          responseSchema: {
            type: "OBJECT",
            properties: Object.fromEntries(names.map((n) => [n, { type: "STRING" }])),
            required: names,
          },
        },
      );
      set((s) => {
        const next = { ...s.vars };
        for (const n of names) {
          if (typeof bag[n] === "string") next[n] = bag[n];
        }
        return { vars: next };
      });
    } catch (e) {
      set({ suggestError: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ suggesting: false });
    }
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
// the one save that matters.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useCompareStore.subscribe((s) => {
  if (s.running || s.rowRunning !== null) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { prompt, scenarios, models, cells, golds, vars } = useCompareStore.getState();
    saveStudy({ prompt, scenarios, models, cells, golds, vars });
  }, 300);
});
