import { useEffect, useMemo, useState } from "react";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import { genId } from "@flowstore/core/ids";
import { substituteVars } from "@flowstore/core/codegen/promptGenerator";
import { generateStructuredJson } from "@flowstore/core/runtime/structuredOutput";
import { translateBatch } from "@flowstore/core/runtime/translate";
import {
  IDLE_CELL,
  buildReportHtml,
  buildStudyBundle,
  cellKey,
  detectPlaceholders,
  estimateVoiceCost,
  parseStudyBundle,
  runMatrix,
} from "@flowstore/studies";
import type { CellState, Scenario, VoiceRates } from "@flowstore/studies";
import { ModelPicker } from "@/components/runtime/ModelPicker";
import { SettingsSheet } from "@/components/sheets/SettingsSheet";
import { DEFAULT_MODEL_ID, resolveDispatch, useSettingsStore } from "@/lib/store/settings";
import { downloadBlob } from "@/lib/download";
import { loadStudy, saveStudy, type StudyGold } from "./studyStorage";
import { GitHubStudyOpenModal, GitHubStudySaveModal } from "./GitHubStudyModals";

// The compare tool: paste a prompt, edit scenarios, pick models, run the
// small-N matrix, read the side-by-sides. The engine lives in
// @flowstore/studies (isomorphic); this page is the browser surface — it
// resolves credentials and renders state.

export function ComparePage() {
  // Hydrate once from localStorage (shared scoped-storage conventions) so a
  // study survives refresh; the effect below writes changes back, debounced.
  const [initial] = useState(loadStudy);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [scenarios, setScenarios] = useState<Scenario[]>(initial.scenarios);
  const [models, setModels] = useState<string[]>(
    initial.models.length > 0 ? initial.models : [DEFAULT_MODEL_ID, DEFAULT_MODEL_ID],
  );
  const [cells, setCells] = useState<Record<string, CellState>>(initial.cells);
  const [selected, setSelected] = useState<string | null>(initial.scenarios[0]?.id ?? null);
  const [running, setRunning] = useState(false);
  // Scenario id of an in-flight single-row run (the sidebar ▶); mutually
  // exclusive with a full run.
  const [rowRunning, setRowRunning] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [githubOpenOpen, setGithubOpenOpen] = useState(false);
  const [githubSaveOpen, setGithubSaveOpen] = useState(false);
  // One gold per scenario id (see StudyGold: column = captured-from this
  // session; absent = imported).
  const [golds, setGolds] = useState<Record<string, StudyGold>>(initial.golds);
  // Placeholder-fill: values for the prompt's {{vars}}. The pasted prompt is
  // never rewritten — the fill is a session-compile bag applied at send time,
  // exactly the promptGenerator override semantics.
  const [vars, setVars] = useState<Record<string, string>>(initial.vars);
  // Cascade voice rates live in the settings store — stack-level facts
  // like the API keys (they describe the user's vendors, not any one study).
  const asrPerMin = useSettingsStore((s) => s.voiceAsrPerMin);
  const setAsrPerMin = useSettingsStore((s) => s.setVoiceAsrPerMin);
  const ttsPerMChars = useSettingsStore((s) => s.voiceTtsPerMChars);
  const setTtsPerMChars = useSettingsStore((s) => s.setVoiceTtsPerMChars);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  // Per-column translate, mirroring the editor's SimulatePanel: manual
  // trigger, one batched call over uncached turns (cached by turn ts), toggle
  // swaps the bubble text to English. Runs on the default model via whatever
  // dispatch resolves (Gemini strict-schema when Google-keyed; chat + lenient
  // parse on OpenRouter et al.) — gated on dispatchability, not on a
  // particular vendor key.
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const [translations, setTranslations] = useState<Record<string, Map<number, string>>>({});
  const [showTranslated, setShowTranslated] = useState<Record<string, boolean>>({});
  const [translating, setTranslating] = useState<string | null>(null);
  const [translateErrors, setTranslateErrors] = useState<Record<string, string>>({});

  // Persist the study — but not mid-run: every cell patch touches `cells`,
  // and serializing all transcripts to localStorage dozens of times during a
  // matrix run is pure waste. The run's final state flip re-arms the effect,
  // so exactly one save fires when it settles.
  const busyRef = running || rowRunning !== null;
  useEffect(() => {
    if (busyRef) return;
    const t = setTimeout(
      () => saveStudy({ prompt, scenarios, models, cells, golds, vars }),
      300,
    );
    return () => clearTimeout(t);
  }, [busyRef, prompt, scenarios, models, cells, golds, vars]);

  // Parsed rates; a blank or non-numeric field contributes nothing, and with
  // both blank the voice estimate disappears everywhere.
  const voiceRates = useMemo<VoiceRates>(() => {
    const num = (s: string) => {
      const n = Number(s);
      return s.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
    };
    return { asrPerMin: num(asrPerMin), ttsPerMChars: num(ttsPerMChars) };
  }, [asrPerMin, ttsPerMChars]);

  const placeholders = useMemo(() => detectPlaceholders(prompt), [prompt]);
  // Only currently-detected, non-empty values participate — stale entries for
  // placeholders no longer in the prompt neither fill nor export.
  const activeVars = useMemo(() => {
    const out: Record<string, string> = {};
    for (const n of placeholders) {
      const v = vars[n];
      if (v?.trim()) out[n] = v;
    }
    return out;
  }, [placeholders, vars]);
  const filledPrompt = useMemo(
    () => (Object.keys(activeVars).length > 0 ? substituteVars(prompt, activeVars) : prompt),
    [prompt, activeVars],
  );

  const patchCell = (key: string, patch: Partial<CellState>) =>
    setCells((prev) => ({ ...prev, [key]: { ...(prev[key] ?? IDLE_CELL), ...patch } }));

  // The engine's ResolveDispatch, backed by the shared settings store. Also
  // the page's single "is this model dispatchable" predicate — translate and
  // suggest reuse it rather than respelling the provider/key check.
  const resolveForEngine = (model: string) => {
    const d = resolveDispatch(model);
    return d.provider && d.apiKey.trim()
      ? { provider: d.provider, apiKey: d.apiKey, baseUrl: d.baseUrl, wireModel: d.wireModel }
      : null;
  };
  const translateReady = resolveForEngine(defaultModel) !== null;

  async function run() {
    setRunning(true);
    setCells({});
    // Fresh transcripts: drop the old translation cache and toggles.
    setTranslations({});
    setShowTranslated({});
    setTranslateErrors({});
    // The engine owns the matrix policy (parallelism, divergence); this page
    // only supplies credentials and mirrors patches into React state.
    await runMatrix({
      systemPrompt: filledPrompt,
      scenarios,
      models,
      resolveDispatch: resolveForEngine,
      onCell: patchCell,
    });
    setRunning(false);
  }

  // Run one scenario row across every model column — a single-scenario matrix,
  // so the engine's column parallelism and divergence pass apply unchanged.
  async function runScenario(s: Scenario) {
    if (running || rowRunning) return;
    setRowRunning(s.id);
    setSelected(s.id);
    // Fresh transcripts for this row: drop its translation cache, toggles,
    // and errors so the columns can't show stale glosses over new turns.
    const dropRow = <T,>(rec: Record<string, T>): Record<string, T> => {
      const next = { ...rec };
      for (let mi = 0; mi < models.length; mi++) delete next[cellKey(s.id, mi)];
      return next;
    };
    setTranslations(dropRow);
    setShowTranslated(dropRow);
    setTranslateErrors(dropRow);
    await runMatrix({
      systemPrompt: filledPrompt,
      scenarios: [s],
      models,
      resolveDispatch: resolveForEngine,
      onCell: patchCell,
    });
    setRowRunning(null);
  }

  // Translate one column's conversation (or toggle back to originals when
  // everything is already cached). Same semantics as the editor's onTranslate.
  async function translateColumn(key: string, turns: TranscriptTurn[]) {
    if (translating) return;
    const cache = translations[key];
    const uncached = turns.filter((t) => t.text && !cache?.has(t.ts));
    if (uncached.length === 0 && showTranslated[key]) {
      setShowTranslated((p) => ({ ...p, [key]: false }));
      return;
    }
    const dispatch = resolveForEngine(defaultModel);
    if (!dispatch) return; // button is gated on this
    setTranslating(key);
    setTranslateErrors((p) => ({ ...p, [key]: "" }));
    try {
      if (uncached.length > 0) {
        const result = await translateBatch(
          uncached.map((t) => ({ id: String(t.ts), text: t.text })),
          dispatch,
        );
        setTranslations((prev) => {
          const m = new Map(prev[key] ?? []);
          for (const [id, eng] of Object.entries(result)) m.set(Number(id), eng);
          return { ...prev, [key]: m };
        });
      }
      setShowTranslated((p) => ({ ...p, [key]: true }));
    } catch (e) {
      setTranslateErrors((p) => ({ ...p, [key]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setTranslating(null);
    }
  }

  // Machine-assist on the TEST side only: the LLM proposes fill values, the
  // user edits them before any run touches a model. Rides the shared
  // structured-output dispatch (strict schema on Google/OpenAI, validated
  // chat elsewhere) on the incumbent model.
  async function suggestVars() {
    const names = placeholders.filter((n) => !(vars[n] ?? "").trim());
    if (names.length === 0) return;
    const d = resolveForEngine(models[0]);
    if (!d) {
      setSuggestError("Suggesting values needs an API key for your current model (settings).");
      return;
    }
    setSuggesting(true);
    setSuggestError(null);
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
      setVars((prev) => {
        const next = { ...prev };
        for (const n of names) {
          if (typeof bag[n] === "string") next[n] = bag[n];
        }
        return next;
      });
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  }

  // The dead-start rescue: a bundled example file (same .flowstore.json the
  // repo ships as its single-file form). Local static asset — no GitHub
  // semantics; PAT users load real projects instead.
  async function loadExample() {
    const files = (await (await fetch("/examples/clinic.flowstore.json")).json()) as Record<string, string>;
    applyBundle(files);
  }

  function applyBundle(files: Record<string, string>) {
    // Parsing (scenarios from cases or golds, gold rebinding, fixture vars)
    // lives beside buildStudyBundle in @flowstore/studies — the page only
    // maps the parsed study into state.
    const parsed = parseStudyBundle(files);
    setPrompt(parsed.prompt);
    setScenarios(parsed.scenarios);
    setGolds(parsed.golds);
    setVars(parsed.vars);
    setCells({});
    setSelected(parsed.scenarios[0]?.id ?? null);
    setSetupOpen(true);
  }

  function uploadBundle(file: File) {
    void file.text().then((text) => applyBundle(JSON.parse(text) as Record<string, string>));
  }

  const busy = running || rowRunning !== null;
  const hasResults = Object.keys(cells).length > 0;
  const totalCells = scenarios.length * models.length;
  const settledCells = Object.values(cells).filter(
    (c) => c.status === "done" || c.status === "error",
  ).length;
  const study = {
    title: "Model comparison study",
    prompt,
    models,
    scenarios,
    cells,
    golds,
    vars: activeVars,
    voiceRates,
  };
  const BROWSER_REPORT_OPTS = {
    latencyNote: "Latency measured from the browser; production latency depends on deployment.",
    footer:
      'Do you want to run studies like this on your own prompts and agents? Try out the tool — <a href="https://compare.flowstore.org">compare.flowstore.org</a>. Free, open source, runs in your browser; your prompt never leaves your machine.',
  };

  return (
    <div className="flex h-screen flex-col bg-surface-sunken text-text-primary">
      <header className="flex items-center gap-4 border-b border-border-default bg-surface-panel px-6 py-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-lg font-semibold leading-tight text-text-primary">flowstore</h1>
          <div className="text-[11px] leading-tight text-text-tertiary">
            runs locally in your browser
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label
            className="flex items-center gap-1 text-[10px] text-text-tertiary"
            title="Your speech-to-text rate, dollars per minute of caller audio — prices the ASR line of the voice estimate (caller speech time modeled at ~150 wpm)"
          >
            asr $/min
            <input
              value={asrPerMin}
              onChange={(e) => setAsrPerMin(e.target.value)}
              placeholder="0.008"
              className="w-16 rounded border border-border-default px-1.5 py-1 text-[11px]"
            />
          </label>
          <label
            className="flex items-center gap-1 text-[10px] text-text-tertiary"
            title="Your text-to-speech rate, dollars per million characters — priced over the agent's actual transcript characters"
          >
            tts $/1M chars
            <input
              value={ttsPerMChars}
              onChange={(e) => setTtsPerMChars(e.target.value)}
              placeholder="8.00"
              className="w-16 rounded border border-border-default px-1.5 py-1 text-[11px]"
            />
          </label>
          <span className="h-5 w-px bg-border-default" />
          <button
            onClick={() => setSetupOpen((v) => !v)}
            className="rounded-full border border-border-default bg-surface-panel px-4 py-1.5 text-xs font-medium hover:bg-surface-hover"
          >
            {setupOpen ? "hide prompt" : "edit prompt"}
          </button>
          <button
            onClick={run}
            disabled={busy || !prompt.trim() || scenarios.length === 0 || models.length === 0}
            className="rounded-full bg-emphasis px-4 py-1.5 text-xs font-medium text-emphasis-fg hover:bg-emphasis-hover disabled:opacity-40"
          >
            {running ? `running ${settledCells}/${totalCells}…` : "run all"}
          </button>
          <span className="h-5 w-px bg-border-default" />
          <button
            onClick={() => setGithubOpenOpen(true)}
            disabled={busy}
            className={iconButtonClass}
            title="Open a study from GitHub"
            aria-label="Open from GitHub"
          >
            <GithubOpenIcon />
          </button>
          <button
            onClick={() => setGithubSaveOpen(true)}
            disabled={busy || (!prompt && scenarios.length === 0)}
            className={iconButtonClass}
            title="Save study to GitHub"
            aria-label="Save to GitHub"
          >
            <GithubSaveIcon />
          </button>
          <span className="h-5 w-px bg-border-default" />
          <label className={iconButtonClass + " cursor-pointer"} title="Upload study (.flowstore.json)" aria-label="Upload study">
            <ImportIcon />
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadBundle(e.target.files[0])}
            />
          </label>
          <div className="relative">
            <button
              onClick={() => setExportOpen((o) => !o)}
              disabled={!hasResults || running}
              className={iconButtonClass}
              title="Export"
              aria-label="Export"
            >
              <ExportIcon />
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 min-w-[14rem] rounded-md border border-border-default bg-surface-raised py-1 shadow-md">
                <button
                  onClick={() => {
                    setExportOpen(false);
                    downloadBlob("compare-report.html", buildReportHtml(study, BROWSER_REPORT_OPTS), "text/html");
                  }}
                  className={menuItemClass}
                >
                  Download report <span className="text-text-disabled">(HTML)</span>
                </button>
                <button
                  onClick={() => {
                    setExportOpen(false);
                    downloadBlob(
                      "compare-study.flowstore.json",
                      JSON.stringify(buildStudyBundle(study), null, 2),
                      "application/json",
                    );
                  }}
                  className={menuItemClass}
                >
                  Export study <span className="text-text-disabled">(flowstore project)</span>
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              setPrompt("");
              setScenarios([]);
              setModels([DEFAULT_MODEL_ID, DEFAULT_MODEL_ID]);
              setCells({});
              setGolds({});
              setVars({});
              setTranslations({});
              setShowTranslated({});
              setTranslateErrors({});
              setSelected(null);
              setSetupOpen(true);
            }}
            disabled={busy || (!prompt && scenarios.length === 0 && !hasResults)}
            className={iconButtonClass}
            title="Clear study"
            aria-label="Clear study"
          >
            <ClearIcon />
          </button>
          <span className="h-5 w-px bg-border-default" />
          <button
            onClick={() => setSettingsOpen(true)}
            className={iconButtonClass}
            title="Settings"
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {setupOpen && (
        <div className="grid grid-cols-2 gap-4 border-b border-border-default bg-surface-panel px-4 py-3">
          <div className="flex flex-col">
            <div className="mb-1 flex h-6 items-center">
              <label className="text-[11px] font-medium text-text-tertiary">
                system prompt (run verbatim on every model)
              </label>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="h-48 w-full resize-y rounded border border-border-default p-2 font-mono text-[11px]"
            />
            {placeholders.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 flex h-6 items-center justify-between">
                  <span className="text-[11px] font-medium text-text-tertiary">
                    placeholders (filled at send time — the prompt text stays verbatim)
                  </span>
                  <button
                    onClick={() => void suggestVars()}
                    disabled={suggesting || placeholders.every((n) => (vars[n] ?? "").trim())}
                    className="rounded-full border border-border-default px-2.5 py-0.5 text-[11px] hover:bg-surface-hover disabled:opacity-40"
                  >
                    {suggesting ? "suggesting…" : "suggest values"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {placeholders.map((name) => (
                    <label
                      key={name}
                      className="flex items-center gap-1.5 rounded border border-border-default py-0.5 pl-1.5 pr-0.5 text-[11px]"
                    >
                      <span className="font-mono text-text-tertiary">{`{{${name}}}`}</span>
                      <input
                        value={vars[name] ?? ""}
                        onChange={(e) => setVars((p) => ({ ...p, [name]: e.target.value }))}
                        placeholder="value"
                        className="w-32 rounded border border-border-default px-1.5 py-0.5 text-[11px]"
                      />
                    </label>
                  ))}
                </div>
                {suggestError && (
                  <div className="mt-1 text-[10px] text-state-error-fg">{suggestError}</div>
                )}
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="mb-1 flex h-6 items-center justify-between">
              <label className="text-[11px] font-medium text-text-tertiary">
                scenarios (one user turn per line)
              </label>
            <button
              onClick={() =>
                setScenarios((prev) => {
                  const id = genId("scenario");
                  setSelected((sel) => sel ?? id);
                  return [
                    {
                      id,
                      scenarioId: id,
                      name: `Scenario ${prev.length + 1}`,
                      language: "EN",
                      turns: [""],
                    },
                    ...prev,
                  ];
                })
              }
              className="rounded-full border border-border-default px-2.5 py-0.5 text-[11px] hover:bg-surface-hover"
            >
              + scenario
            </button>
            </div>

            <div className="flex h-48 flex-col gap-2 overflow-y-auto rounded border border-border-default bg-surface-panel p-2">
            {scenarios.map((s, i) => (
              <div key={s.id}>
                <div className="mb-1 flex items-center gap-2">
                  <input
                    value={s.name}
                    onChange={(e) => updateScenario(i, { name: e.target.value })}
                    className="flex-1 rounded border border-border-default px-1.5 py-0.5 text-[11px]"
                  />
                  <input
                    value={s.language}
                    onChange={(e) => updateScenario(i, { language: e.target.value })}
                    className="w-10 rounded border border-border-default px-1.5 py-0.5 text-center text-[11px]"
                    title="language code"
                  />
                  <button
                    onClick={() => setScenarios((prev) => prev.filter((_, j) => j !== i))}
                    className="text-[11px] text-text-disabled hover:text-state-error-fg"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={s.turns.join("\n")}
                  onChange={(e) =>
                    updateScenario(i, { turns: e.target.value.split("\n") })
                  }
                  className="h-16 w-full resize-y rounded border border-border-default p-1.5 text-[11px]"
                />
              </div>
            ))}
            </div>
          </div>
        </div>
      )}

      {!prompt && scenarios.length === 0 && !hasResults ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="text-sm text-text-tertiary">
              Paste a system prompt above, upload a study, or start from the example.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadExample()}
                className="rounded-full border border-border-default bg-surface-panel px-4 py-1.5 text-xs font-medium hover:bg-surface-hover"
              >
                load example (clinic agent)
              </button>
              <label className="cursor-pointer rounded-full border border-border-default bg-surface-panel px-4 py-1.5 text-xs font-medium hover:bg-surface-hover">
                upload .flowstore.json
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadBundle(e.target.files[0])}
                />
              </label>
            </div>
          </div>
        </div>
      ) : (
      <main className="flex flex-1 min-h-0">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-border-default bg-surface-panel">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-surface-sunken">
              <tr>
                <th className="h-10 border-b border-border-default px-2 text-left align-middle font-medium">
                  scenario
                </th>
                <th className="h-10 w-8 border-b border-l border-border-default px-1 align-middle" />

              </tr>
            </thead>
            <tbody>
              <tr aria-hidden="true">
                <td colSpan={2} className="h-2 p-0" />
              </tr>
              {scenarios.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={`group cursor-pointer hover:bg-surface-hover ${selected === s.id ? "bg-surface-selected" : ""}`}
                >
                  <td className="border-b border-border-subtle px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate">
                        {s.name} <span className="text-text-disabled">{s.language}</span>
                        {golds[s.id] && golds[s.id].column === undefined && (
                          <span
                            className="ml-1 text-[9px] text-state-warning-fg"
                            title="An imported blessed gold transcript exists for this scenario"
                          >
                            gold ✓
                          </span>
                        )}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void runScenario(s);
                        }}
                        disabled={busy || !prompt.trim() || models.length === 0}
                        className="invisible shrink-0 rounded-md border border-border-default px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-surface-hover disabled:opacity-40 group-hover:visible"
                        title="Run this scenario on all models"
                        aria-label={`Run scenario ${s.name}`}
                      >
                        ▶
                      </button>
                    </div>
                  </td>
                  <td className="border-b border-l border-border-subtle px-1 py-1.5 text-center">
                    <ScenarioChip cells={models.map((_, i) => cells[cellKey(s.id, i)])} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </aside>

        <section className="flex flex-1 min-w-0 divide-x divide-border-default overflow-x-auto">
          {selected &&
            models.map((m, i) => {
              const key = cellKey(selected, i);
              const c = cells[key];
              const colTurns = c?.turns ?? [];
              const hasUncached = colTurns.some((t) => t.text && !translations[key]?.has(t.ts));
              const translateLabel =
                translating === key
                  ? "…"
                  : showTranslated[key] && !hasUncached
                    ? "show original"
                    : "translate";
              return (
                <div key={i} className="flex min-w-[280px] flex-1 flex-col">
                  <div className="flex h-10 items-center gap-1.5 border-b border-border-default bg-surface-panel px-3">
                    {i === 0 && <span className="shrink-0 text-[10px] text-text-disabled">current</span>}
                    <ModelPicker
                      value={m}
                      onChange={(v) => setModels((prev) => prev.map((x, j) => (j === i ? v : x)))}
                      disabled={busy}
                      showUnconfigured
                      className="min-w-0 text-[11px]"
                    />
                    {i > 0 && (
                      <button
                        onClick={() => setModels((prev) => prev.filter((_, j) => j !== i))}
                        disabled={busy}
                        className="shrink-0 rounded-md border border-border-default px-1.5 py-0.5 text-[11px] text-text-tertiary hover:bg-state-error-bg hover:text-state-error-fg"
                        title="Remove column"
                      >
                        ✕
                      </button>
                    )}
                    {c?.divergent && (
                      <span className="rounded-full bg-state-warning-bg px-1.5 text-[9px] text-state-warning-fg">
                        diverges
                      </span>
                    )}
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {translateReady && colTurns.some((t) => t.text) && (
                      <button
                        onClick={() => void translateColumn(key, colTurns)}
                        disabled={translating !== null}
                        title="Translate this conversation to English. Press again to refresh after new turns; press once more to show originals."
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-surface-hover disabled:opacity-40"
                      >
                        🌐 {translateLabel}
                      </button>
                    )}
                    <ColumnStats cell={c} rates={voiceRates} />
                    {/* capture-gold disabled for now (Tapan 2026-07-26) — uncomment
                        to restore; import-side golds and bundle round-trip are
                        unaffected.
                    {c?.status === "done" && selected && (
                      golds[selected]?.column === i ? (
                        <span className="shrink-0 rounded-md bg-state-warning-bg px-1.5 py-0.5 text-[10px] text-state-warning-fg" title="This transcript is the blessed gold for this scenario">
                          gold ✓
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            const sc = scenarios.find((x) => x.id === selected);
                            if (!sc || !c) return;
                            setGolds((prev) => ({
                              ...prev,
                              [selected]: {
                                scenarioId: sc.scenarioId,
                                language: sc.language,
                                name: sc.name,
                                column: i,
                                turns: c.turns.map((t) => ({ role: t.role, text: t.text })),
                              },
                            }));
                          }}
                          className="shrink-0 rounded-md border border-border-default px-1.5 py-0.5 text-[10px] text-text-tertiary hover:bg-state-warning-bg hover:text-state-warning-fg"
                          title="Capture this transcript as the gold (blessed reference) for this scenario"
                        >
                          capture gold
                        </button>
                      )
                    )}
                    */}
                    {i === models.length - 1 && models.length < 6 && (
                      <button
                        onClick={() => setModels((prev) => [...prev, DEFAULT_MODEL_ID])}
                        disabled={busy}
                        className="shrink-0 rounded-md border border-border-default px-2 py-0.5 text-[12px] font-medium text-text-secondary hover:bg-surface-hover"
                        title="Add model column"
                      >
                        +
                      </button>
                    )}
                    </div>
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                    {translateErrors[key] && (
                      <div className="text-[10px] text-state-error-fg">{translateErrors[key]}</div>
                    )}
                    {colTurns.map((t, k) => (
                      <TurnBubble
                        key={k}
                        turn={t}
                        displayText={showTranslated[key] ? translations[key]?.get(t.ts) : undefined}
                      />
                    ))}
                    {c?.status === "running" && (
                      <div className="mr-8 rounded-lg border border-dashed border-border-default px-3 py-2 text-xs text-text-disabled">
                        …
                      </div>
                    )}
                    {c?.status === "error" && (
                      <div className="rounded-lg border border-state-error-line bg-state-error-bg px-3 py-2 text-xs text-state-error-fg">
                        {c.error}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </section>
      </main>
      )}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {githubOpenOpen && (
        <GitHubStudyOpenModal
          onClose={() => setGithubOpenOpen(false)}
          onOpenSettings={() => {
            setGithubOpenOpen(false);
            setSettingsOpen(true);
          }}
          onFiles={applyBundle}
        />
      )}
      {githubSaveOpen && (
        <GitHubStudySaveModal
          onClose={() => setGithubSaveOpen(false)}
          onOpenSettings={() => {
            setGithubSaveOpen(false);
            setSettingsOpen(true);
          }}
          buildFiles={() => buildStudyBundle(study)}
        />
      )}
    </div>
  );

  function updateScenario(i: number, patch: Partial<Scenario>) {
    setScenarios((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }
}

// One aggregate indicator per scenario row — per-model detail lives in the
// side-by-side view. Priority: running > error > diverged > clean.
function ScenarioChip({ cells }: { cells: (CellState | undefined)[] }) {
  const live = cells.filter((c): c is CellState => !!c && c.status !== "idle");
  if (live.length === 0) return <span className="text-text-disabled">·</span>;
  if (live.some((c) => c.status === "running")) return <span className="text-text-disabled">…</span>;
  if (live.some((c) => c.status === "error")) return <span className="text-state-error-fg">✕</span>;
  return live.some((c) => c.divergent) ? (
    <span className="text-state-warning-fg" title="a model diverges from your current one here — read it">
      ▲
    </span>
  ) : (
    <span className="text-state-success-fg" title="all models agree with your current one">✓</span>
  );
}

function ColumnStats({ cell, rates }: { cell?: CellState; rates: VoiceRates }) {
  if (!cell?.usage) return null;
  const u = cell.usage;
  // ≈ marks the modeled figure; measured LLM $ stays unprefixed beside it.
  const voice = estimateVoiceCost(cell.turns, u.cost, rates);
  const fmt = (n: number) => `$${n.toFixed(n >= 0.01 ? 3 : 4)}`;
  const voiceTitle = voice
    ? [
        voice.llmCost !== undefined ? `LLM ${fmt(voice.llmCost)} (measured)` : "LLM n/a",
        voice.ttsCost !== undefined ? `TTS ${fmt(voice.ttsCost)}` : null,
        voice.asrCost !== undefined ? `ASR ${fmt(voice.asrCost)} (est)` : null,
        `~${voice.speechMinutes.toFixed(1)} min speech at 150 wpm`,
      ]
        .filter(Boolean)
        .join(" + ")
    : undefined;
  // Rates filled = voice mode: the voice total replaces the LLM-only figure
  // (one indicator per fact — the LLM component lives in the tooltip). No
  // rates = text mode, measured LLM $ as before.
  return (
    <span className="whitespace-nowrap text-[10px] text-text-tertiary">
      {`${u.inputTokens.toLocaleString()}/${u.outputTokens.toLocaleString()}`}
      {voice ? (
        <span title={voiceTitle}>{` · ≈${fmt(voice.total)} voice`}</span>
      ) : (
        u.cost !== undefined && ` · $${u.cost.toFixed(4)}`
      )}
      {cell.totalMs > 0 && ` · ${(cell.totalMs / 1000).toFixed(1)}s`}
    </span>
  );
}

// displayText swaps in the English translation while the column's translate
// toggle is on (same substitution the editor's TurnView does) — the stored
// transcript stays verbatim.
function TurnBubble({ turn, displayText }: { turn: TranscriptTurn; displayText?: string }) {
  const shown = displayText ?? turn.text;
  return turn.role === "user" ? (
    <div className="ml-8 rounded-lg bg-emphasis px-3 py-2 text-xs text-emphasis-fg">{shown}</div>
  ) : (
    <div className="mr-8 rounded-lg border border-border-default bg-surface-panel px-3 py-2 text-xs">
      {shown}
      {turn.latencyMs !== undefined && (
        <div className="mt-1 text-[10px] text-text-disabled">{(turn.latencyMs / 1000).toFixed(1)}s</div>
      )}
    </div>
  );
}

// Icon buttons mirror the editor toolbar (ImportExport.tsx) — same classes,
// same icons, same order (export, clear, | settings). Icons duplicated for
// now; extract a shared icon lib when a third consumer appears.
const iconButtonClass =
  "rounded-md border border-border-default p-1.5 text-text-secondary hover:bg-surface-hover disabled:opacity-50 disabled:hover:bg-transparent";
const menuItemClass =
  "block w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover";

function GithubOpenIcon() {
  // Cloud with downward arrow — open from remote (same glyph as the editor).
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </svg>
  );
}

function GithubSaveIcon() {
  // Cloud with upward arrow — push to remote (same glyph as the editor).
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

