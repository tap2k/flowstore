import { useMemo, useState } from "react";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import {
  buildReportHtml,
  buildStudyBundle,
  cellKey,
  detectPlaceholders,
  estimateVoiceCost,
} from "@flowstore/studies";
import type { CellState, VoiceRates } from "@flowstore/studies";
import { ModelPicker } from "@/components/runtime/ModelPicker";
import { SettingsSheet } from "@/components/sheets/SettingsSheet";
import { useSettingsStore } from "@/lib/store/settings";
import { downloadBlob } from "@/lib/download";
import { activeVarsOf, resolveForEngine, useCompareStore } from "./store";
import { GitHubStudyOpenModal, GitHubStudySaveModal } from "./GitHubStudyModals";

// The compare tool: paste a prompt, edit scenarios, pick models, run the
// small-N matrix, read the side-by-sides. The engine lives in
// @flowstore/studies (isomorphic), state and behavior in ./store (zustand,
// the editor idiom) — this component only renders.

export function ComparePage() {
  const s = useCompareStore();
  // Cascade voice rates live in the settings store — stack-level facts
  // like the API keys (they describe the user's vendors, not any one study).
  const asrPerMin = useSettingsStore((st) => st.voiceAsrPerMin);
  const setAsrPerMin = useSettingsStore((st) => st.setVoiceAsrPerMin);
  const ttsPerMChars = useSettingsStore((st) => st.voiceTtsPerMChars);
  const setTtsPerMChars = useSettingsStore((st) => st.setVoiceTtsPerMChars);
  const defaultModel = useSettingsStore((st) => st.defaultModel);

  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [githubOpenOpen, setGithubOpenOpen] = useState(false);
  const [githubSaveOpen, setGithubSaveOpen] = useState(false);

  // Parsed rates; a blank or non-numeric field contributes nothing, and with
  // both blank the voice estimate disappears everywhere.
  const voiceRates = useMemo<VoiceRates>(() => {
    const num = (v: string) => {
      const n = Number(v);
      return v.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
    };
    return { asrPerMin: num(asrPerMin), ttsPerMChars: num(ttsPerMChars) };
  }, [asrPerMin, ttsPerMChars]);

  const placeholders = useMemo(() => detectPlaceholders(s.prompt), [s.prompt]);
  const translateReady = resolveForEngine(defaultModel) !== null;

  const busy = s.running || s.rowRunning !== null;
  const hasResults = Object.keys(s.cells).length > 0;
  const totalCells = s.scenarios.length * s.models.length;
  const settledCells = Object.values(s.cells).filter(
    (c) => c.status === "done" || c.status === "error",
  ).length;
  const study = {
    title: "Model comparison study",
    prompt: s.prompt,
    models: s.models,
    scenarios: s.scenarios,
    cells: s.cells,
    golds: s.golds,
    vars: activeVarsOf(s.prompt, s.vars),
    voiceRates,
  };
  const BROWSER_REPORT_OPTS = {
    latencyNote: "Latency measured from the browser; production latency depends on deployment.",
    footer:
      'Do you want to run studies like this on your own prompts and agents? Try out the tool — <a href="https://compare.flowstore.org">compare.flowstore.org</a>. Free, open source, runs in your browser; your prompt never leaves your machine.',
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-50 text-zinc-900">
      <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-6 py-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-lg font-semibold leading-tight text-zinc-900">flowstore</h1>
          <div className="text-[11px] leading-tight text-zinc-500">
            runs locally in your browser
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label
            className="flex items-center gap-1 text-[10px] text-zinc-500"
            title="Your speech-to-text rate, dollars per minute of caller audio — prices the ASR line of the voice estimate (caller speech time modeled at ~150 wpm)"
          >
            asr $/min
            <input
              value={asrPerMin}
              onChange={(e) => setAsrPerMin(e.target.value)}
              placeholder="0.008"
              className="w-16 rounded border border-zinc-300 px-1.5 py-1 text-[11px]"
            />
          </label>
          <label
            className="flex items-center gap-1 text-[10px] text-zinc-500"
            title="Your text-to-speech rate, dollars per million characters — priced over the agent's actual transcript characters"
          >
            tts $/1M chars
            <input
              value={ttsPerMChars}
              onChange={(e) => setTtsPerMChars(e.target.value)}
              placeholder="8.00"
              className="w-16 rounded border border-zinc-300 px-1.5 py-1 text-[11px]"
            />
          </label>
          <span className="h-5 w-px bg-zinc-200" />
          <button
            onClick={() => s.setSetupOpen(!s.setupOpen)}
            className="rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-xs font-medium hover:bg-zinc-50"
          >
            {s.setupOpen ? "hide prompt" : "edit prompt"}
          </button>
          <button
            onClick={() => void s.run()}
            disabled={busy || !s.prompt.trim() || s.scenarios.length === 0 || s.models.length === 0}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {s.running ? `running ${settledCells}/${totalCells}…` : "run all"}
          </button>
          <span className="h-5 w-px bg-zinc-200" />
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
            disabled={busy || (!s.prompt && s.scenarios.length === 0)}
            className={iconButtonClass}
            title="Save study to GitHub"
            aria-label="Save to GitHub"
          >
            <GithubSaveIcon />
          </button>
          <span className="h-5 w-px bg-zinc-200" />
          <label className={iconButtonClass + " cursor-pointer"} title="Upload study (.flowstore.json)" aria-label="Upload study">
            <ImportIcon />
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && s.uploadBundle(e.target.files[0])}
            />
          </label>
          <div className="relative">
            <button
              onClick={() => setExportOpen((o) => !o)}
              disabled={!hasResults || s.running}
              className={iconButtonClass}
              title="Export"
              aria-label="Export"
            >
              <ExportIcon />
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 min-w-[14rem] rounded-md border border-zinc-200 bg-white py-1 shadow-md">
                <button
                  onClick={() => {
                    setExportOpen(false);
                    downloadBlob("compare-report.html", buildReportHtml(study, BROWSER_REPORT_OPTS), "text/html");
                  }}
                  className={menuItemClass}
                >
                  Download report <span className="text-zinc-400">(HTML)</span>
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
                  Export study <span className="text-zinc-400">(flowstore project)</span>
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => s.clearStudy()}
            disabled={busy || (!s.prompt && s.scenarios.length === 0 && !hasResults)}
            className={iconButtonClass}
            title="Clear study"
            aria-label="Clear study"
          >
            <ClearIcon />
          </button>
          <span className="h-5 w-px bg-zinc-200" />
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

      {s.setupOpen && (
        <div className="grid grid-cols-2 gap-4 border-b border-zinc-200 bg-white px-4 py-3">
          <div className="flex flex-col">
            <div className="mb-1 flex h-6 items-center">
              <label className="text-[11px] font-medium text-zinc-500">
                system prompt (run verbatim on every model)
              </label>
            </div>
            <textarea
              value={s.prompt}
              onChange={(e) => s.setPrompt(e.target.value)}
              className="h-48 w-full resize-y rounded border border-zinc-300 p-2 font-mono text-[11px]"
            />
            {placeholders.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 flex h-6 items-center justify-between">
                  <span className="text-[11px] font-medium text-zinc-500">
                    placeholders (filled at send time — the prompt text stays verbatim)
                  </span>
                  <button
                    onClick={() => void s.suggestVars()}
                    disabled={s.suggesting || placeholders.every((n) => (s.vars[n] ?? "").trim())}
                    className="rounded-full border border-zinc-300 px-2.5 py-0.5 text-[11px] hover:bg-zinc-50 disabled:opacity-40"
                  >
                    {s.suggesting ? "suggesting…" : "suggest values"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {placeholders.map((name) => (
                    <label
                      key={name}
                      className="flex items-center gap-1.5 rounded border border-zinc-200 py-0.5 pl-1.5 pr-0.5 text-[11px]"
                    >
                      <span className="font-mono text-zinc-500">{`{{${name}}}`}</span>
                      <input
                        value={s.vars[name] ?? ""}
                        onChange={(e) => s.setVar(name, e.target.value)}
                        placeholder="value"
                        className="w-32 rounded border border-zinc-200 px-1.5 py-0.5 text-[11px]"
                      />
                    </label>
                  ))}
                </div>
                {s.suggestError && (
                  <div className="mt-1 text-[10px] text-red-600">{s.suggestError}</div>
                )}
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="mb-1 flex h-6 items-center justify-between">
              <label className="text-[11px] font-medium text-zinc-500">
                scenarios (one user turn per line)
              </label>
            <button
              onClick={() => s.addScenario()}
              className="rounded-full border border-zinc-300 px-2.5 py-0.5 text-[11px] hover:bg-zinc-50"
            >
              + scenario
            </button>
            </div>

            <div className="flex h-48 flex-col gap-2 overflow-y-auto rounded border border-zinc-300 bg-white p-2">
            {s.scenarios.map((sc, i) => (
              <div key={sc.id}>
                <div className="mb-1 flex items-center gap-2">
                  <input
                    value={sc.name}
                    onChange={(e) => s.updateScenario(i, { name: e.target.value })}
                    className="flex-1 rounded border border-zinc-200 px-1.5 py-0.5 text-[11px]"
                  />
                  <input
                    value={sc.language}
                    onChange={(e) => s.updateScenario(i, { language: e.target.value })}
                    className="w-10 rounded border border-zinc-200 px-1.5 py-0.5 text-center text-[11px]"
                    title="language code"
                  />
                  <button
                    onClick={() => s.removeScenario(i)}
                    className="text-[11px] text-zinc-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={sc.turns.join("\n")}
                  onChange={(e) => s.updateScenario(i, { turns: e.target.value.split("\n") })}
                  className="h-16 w-full resize-y rounded border border-zinc-200 p-1.5 text-[11px]"
                />
              </div>
            ))}
            </div>
          </div>
        </div>
      )}

      {!s.prompt && s.scenarios.length === 0 && !hasResults ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="text-sm text-zinc-500">
              Paste a system prompt above, upload a study, or start from the example.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void s.loadExample()}
                className="rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-xs font-medium hover:bg-zinc-50"
              >
                load example (clinic agent)
              </button>
              <label className="cursor-pointer rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-xs font-medium hover:bg-zinc-50">
                upload .flowstore.json
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && s.uploadBundle(e.target.files[0])}
                />
              </label>
            </div>
          </div>
        </div>
      ) : (
      <main className="flex flex-1 min-h-0">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-zinc-50">
              <tr>
                <th className="h-10 border-b border-zinc-200 px-2 text-left align-middle font-medium">
                  scenario
                </th>
                <th className="h-10 w-8 border-b border-l border-zinc-200 px-1 align-middle" />

              </tr>
            </thead>
            <tbody>
              <tr aria-hidden="true">
                <td colSpan={2} className="h-2 p-0" />
              </tr>
              {s.scenarios.map((sc) => (
                <tr
                  key={sc.id}
                  onClick={() => s.setSelected(sc.id)}
                  className={`group cursor-pointer hover:bg-zinc-50 ${s.selected === sc.id ? "bg-zinc-100" : ""}`}
                >
                  <td className="border-b border-zinc-100 px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate">
                        {sc.name} <span className="text-zinc-400">{sc.language}</span>
                        {s.golds[sc.id] && s.golds[sc.id].column === undefined && (
                          <span
                            className="ml-1 text-[9px] text-amber-700"
                            title="An imported blessed gold transcript exists for this scenario"
                          >
                            gold ✓
                          </span>
                        )}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void s.runScenario(sc);
                        }}
                        disabled={busy || !s.prompt.trim() || s.models.length === 0}
                        className="invisible shrink-0 rounded-md border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 group-hover:visible"
                        title="Run this scenario on all models"
                        aria-label={`Run scenario ${sc.name}`}
                      >
                        ▶
                      </button>
                    </div>
                  </td>
                  <td className="border-b border-l border-zinc-100 px-1 py-1.5 text-center">
                    <ScenarioChip cells={s.models.map((_, i) => s.cells[cellKey(sc.id, i)])} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </aside>

        <section className="flex flex-1 min-w-0 divide-x divide-zinc-200 overflow-x-auto">
          {s.selected &&
            s.models.map((m, i) => {
              const key = cellKey(s.selected!, i);
              const c = s.cells[key];
              const colTurns = c?.turns ?? [];
              const hasUncached = colTurns.some((t) => t.text && !s.translations[key]?.has(t.ts));
              const translateLabel =
                s.translating === key
                  ? "…"
                  : s.showTranslated[key] && !hasUncached
                    ? "show original"
                    : "translate";
              return (
                <div key={i} className="flex min-w-[280px] flex-1 flex-col">
                  <div className="flex h-10 items-center gap-1.5 border-b border-zinc-200 bg-white px-3">
                    {i === 0 && <span className="shrink-0 text-[10px] text-zinc-400">current</span>}
                    <ModelPicker
                      value={m}
                      onChange={(v) => s.setModelAt(i, v)}
                      disabled={busy}
                      showUnconfigured
                      className="min-w-0 text-[11px]"
                    />
                    {i > 0 && (
                      <button
                        onClick={() => s.removeModel(i)}
                        disabled={busy}
                        className="shrink-0 rounded-md border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-red-50 hover:text-red-600"
                        title="Remove column"
                      >
                        ✕
                      </button>
                    )}
                    {c?.divergent && (
                      <span className="rounded-full bg-amber-100 px-1.5 text-[9px] text-amber-800">
                        diverges
                      </span>
                    )}
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {translateReady && colTurns.some((t) => t.text) && (
                      <button
                        onClick={() => void s.translateColumn(key, colTurns)}
                        disabled={s.translating !== null}
                        title="Translate this conversation to English. Press again to refresh after new turns; press once more to show originals."
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
                      >
                        🌐 {translateLabel}
                      </button>
                    )}
                    <ColumnStats cell={c} rates={voiceRates} />
                    {/* capture-gold disabled for now (Tapan 2026-07-26) — uncomment
                        to restore (store.captureGold); import-side golds and
                        bundle round-trip are unaffected.
                    {c?.status === "done" && s.selected && (
                      s.golds[s.selected]?.column === i ? (
                        <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700" title="This transcript is the blessed gold for this scenario">
                          gold ✓
                        </span>
                      ) : (
                        <button
                          onClick={() => s.captureGold(s.selected!, i)}
                          className="shrink-0 rounded-md border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-amber-50 hover:text-amber-700"
                          title="Capture this transcript as the gold (blessed reference) for this scenario"
                        >
                          capture gold
                        </button>
                      )
                    )}
                    */}
                    {i === s.models.length - 1 && s.models.length < 6 && (
                      <button
                        onClick={() => s.addModel()}
                        disabled={busy}
                        className="shrink-0 rounded-md border border-zinc-200 px-2 py-0.5 text-[12px] font-medium text-zinc-600 hover:bg-zinc-100"
                        title="Add model column"
                      >
                        +
                      </button>
                    )}
                    </div>
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                    {s.translateErrors[key] && (
                      <div className="text-[10px] text-red-600">{s.translateErrors[key]}</div>
                    )}
                    {colTurns.map((t, k) => (
                      <TurnBubble
                        key={k}
                        turn={t}
                        displayText={s.showTranslated[key] ? s.translations[key]?.get(t.ts) : undefined}
                      />
                    ))}
                    {c?.status === "running" && (
                      <div className="mr-8 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-400">
                        …
                      </div>
                    )}
                    {c?.status === "error" && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
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
          onFiles={s.applyBundle}
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
}

// One aggregate indicator per scenario row — per-model detail lives in the
// side-by-side view. Priority: running > error > diverged > clean.
function ScenarioChip({ cells }: { cells: (CellState | undefined)[] }) {
  const live = cells.filter((c): c is CellState => !!c && c.status !== "idle");
  if (live.length === 0) return <span className="text-zinc-300">·</span>;
  if (live.some((c) => c.status === "running")) return <span className="text-zinc-400">…</span>;
  if (live.some((c) => c.status === "error")) return <span className="text-red-600">✕</span>;
  return live.some((c) => c.divergent) ? (
    <span className="text-amber-600" title="a model diverges from your current one here — read it">
      ▲
    </span>
  ) : (
    <span className="text-emerald-600" title="all models agree with your current one">✓</span>
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
    <span className="whitespace-nowrap text-[10px] text-zinc-500">
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
    <div className="ml-8 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white">{shown}</div>
  ) : (
    <div className="mr-8 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
      {shown}
      {turn.latencyMs !== undefined && (
        <div className="mt-1 text-[10px] text-zinc-400">{(turn.latencyMs / 1000).toFixed(1)}s</div>
      )}
    </div>
  );
}

// Icon buttons mirror the editor toolbar (ImportExport.tsx) — same classes,
// same icons, same order (export, clear, | settings). Icons duplicated for
// now; extract a shared icon lib when a third consumer appears.
const iconButtonClass =
  "rounded-md border border-zinc-200 p-1.5 text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 disabled:hover:bg-transparent";
const menuItemClass =
  "block w-full text-left px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100";

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
