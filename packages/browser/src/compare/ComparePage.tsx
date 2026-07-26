import { useState } from "react";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import { genId } from "@flowstore/core/ids";
import { IDLE_CELL, buildReportHtml, buildStudyBundle, cellKey, runMatrix } from "@flowstore/studies";
import type { CapturedGold, CellState, Scenario } from "@flowstore/studies";
import { ModelPicker } from "@/components/runtime/ModelPicker";
import { SettingsSheet } from "@/components/sheets/SettingsSheet";
import { DEFAULT_MODEL_ID, resolveDispatch } from "@/lib/store/settings";
import { downloadBlob } from "@/lib/download";

// The compare tool: paste a prompt, edit scenarios, pick models, run the
// small-N matrix, read the side-by-sides. The engine lives in
// @flowstore/studies (isomorphic); this page is the browser surface — it
// resolves credentials and renders state.

export function ComparePage() {
  const [prompt, setPrompt] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [models, setModels] = useState<string[]>([DEFAULT_MODEL_ID, DEFAULT_MODEL_ID]);
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [selected, setSelected] = useState<string | null>(scenarios[0]?.id ?? null);
  const [monthly, setMonthly] = useState(30000);
  const [running, setRunning] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // One gold per scenario id; value records which column it was captured from.
  const [golds, setGolds] = useState<Record<string, CapturedGold & { column: number }>>({});


  const patchCell = (key: string, patch: Partial<CellState>) =>
    setCells((prev) => ({ ...prev, [key]: { ...(prev[key] ?? IDLE_CELL), ...patch } }));

  async function run() {
    setRunning(true);
    setSetupOpen(false);
    setCells({});
    // The engine owns the matrix policy (parallelism, divergence); this page
    // only supplies credentials and mirrors patches into React state.
    await runMatrix({
      systemPrompt: prompt,
      scenarios,
      models,
      resolveDispatch: (model) => {
        const d = resolveDispatch(model);
        return d.provider && d.apiKey.trim()
          ? { provider: d.provider, apiKey: d.apiKey, baseUrl: d.baseUrl, wireModel: d.wireModel }
          : null;
      },
      onCell: patchCell,
    });
    setRunning(false);
  }

  // The dead-start rescue: a bundled example file (same .flowstore.json the
  // repo ships as its single-file form). Local static asset — no GitHub
  // semantics; PAT users load real projects instead.
  async function loadExample() {
    const files = (await (await fetch("/examples/clinic.flowstore.json")).json()) as Record<string, string>;
    applyBundle(files);
  }

  function applyBundle(files: Record<string, string>) {
    const agent = files["agent.json"] ? JSON.parse(files["agent.json"]) : {};
    const cases = Object.keys(files)
      .filter((k) => k.startsWith("tests/cases/") && k.endsWith(".test.json"))
      .map((k) => JSON.parse(files[k]));
    applyProject(agent, cases);
  }

  function applyProject(agent: { system_prompt?: string }, cases: Array<Record<string, unknown>>) {
    setPrompt(agent.system_prompt ?? "");
    setScenarios(
      cases.map((c) => ({
        id: String(c.id),
        scenarioId: String(c.scenario_id ?? c.id),
        name: String(c.name ?? c.id),
        language: String(c.language ?? "EN"),
        turns: Array.isArray(c.user_turns) ? c.user_turns.map(String) : [],
      })),
    );
    setCells({});
    setSelected(cases[0] ? String(cases[0].id) : null);
    setSetupOpen(true);
  }

  function uploadBundle(file: File) {
    void file.text().then((text) => applyBundle(JSON.parse(text) as Record<string, string>));
  }

  const hasResults = Object.keys(cells).length > 0;
  const study = {
    title: "Model comparison study",
    prompt,
    models,
    scenarios,
    cells,
    monthlyConversations: monthly,
    golds,
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
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setSetupOpen((v) => !v)}
            className="rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-xs font-medium hover:bg-zinc-50"
          >
            {setupOpen ? "hide prompt" : "edit prompt"}
          </button>
          <button
            onClick={run}
            disabled={running || !prompt.trim() || scenarios.length === 0 || models.length === 0}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {running ? "running…" : "run all"}
          </button>
          <span className="h-5 w-px bg-zinc-200" />
          {hasResults && !running && (
            <label className="flex items-center gap-1 text-[10px] text-zinc-500">
              conv/mo
              <input
                type="number"
                value={monthly}
                onChange={(e) => setMonthly(Number(e.target.value) || 0)}
                className="w-20 rounded border border-zinc-300 px-1.5 py-1 text-[11px]"
              />
            </label>
          )}
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
            onClick={() => {
              setPrompt("");
              setScenarios([]);
              setModels([DEFAULT_MODEL_ID, DEFAULT_MODEL_ID]);
              setCells({});
              setSelected(null);
              setSetupOpen(true);
            }}
            disabled={running || (!prompt && scenarios.length === 0 && !hasResults)}
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

      {setupOpen && (
        <div className="grid grid-cols-2 gap-4 border-b border-zinc-200 bg-white px-4 py-3">
          <div className="flex flex-col">
            <label className="mb-1 text-[11px] font-medium text-zinc-500">
              system prompt (run verbatim on every model)
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="h-48 w-full resize-y rounded border border-zinc-300 p-2 font-mono text-[11px]"
            />
          </div>
          <div className="flex max-h-60 flex-col gap-2 overflow-y-auto">
            <label className="text-[11px] font-medium text-zinc-500">
              scenarios (one user turn per line)
            </label>
            {scenarios.map((s, i) => (
              <div key={s.id} className="rounded border border-zinc-200 p-2">
                <div className="mb-1 flex items-center gap-2">
                  <input
                    value={s.name}
                    onChange={(e) => updateScenario(i, { name: e.target.value })}
                    className="flex-1 rounded border border-zinc-200 px-1.5 py-0.5 text-[11px]"
                  />
                  <input
                    value={s.language}
                    onChange={(e) => updateScenario(i, { language: e.target.value })}
                    className="w-10 rounded border border-zinc-200 px-1.5 py-0.5 text-center text-[11px]"
                    title="language code"
                  />
                  <button
                    onClick={() => setScenarios((prev) => prev.filter((_, j) => j !== i))}
                    className="text-[11px] text-zinc-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={s.turns.join("\n")}
                  onChange={(e) =>
                    updateScenario(i, { turns: e.target.value.split("\n") })
                  }
                  className="h-16 w-full resize-y rounded border border-zinc-200 p-1.5 text-[11px]"
                />
              </div>
            ))}
            <button
              onClick={() =>
                setScenarios((prev) => {
                  const id = genId("scenario");
                  setSelected((sel) => sel ?? id);
                  return [
                    ...prev,
                    {
                      id,
                      scenarioId: id,
                      name: `Scenario ${prev.length + 1}`,
                      language: "EN",
                      turns: [""],
                    },
                  ];
                })
              }
              className="self-start rounded-full border border-zinc-300 px-3 py-1 text-[11px] hover:bg-zinc-50"
            >
              + scenario
            </button>
          </div>
        </div>
      )}

      {!prompt && scenarios.length === 0 && !hasResults ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="text-sm text-zinc-500">
              Paste a system prompt above, upload a study, or start from the example.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadExample()}
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
                  onChange={(e) => e.target.files?.[0] && uploadBundle(e.target.files[0])}
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
              {scenarios.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={`cursor-pointer hover:bg-zinc-50 ${selected === s.id ? "bg-zinc-100" : ""}`}
                >
                  <td className="border-b border-zinc-100 px-2 py-1.5">
                    {s.name} <span className="text-zinc-400">{s.language}</span>
                  </td>
                  <td className="border-b border-l border-zinc-100 px-1 py-1.5 text-center">
                    <ScenarioChip cells={models.map((_, i) => cells[cellKey(s.id, i)])} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </aside>

        <section className="flex flex-1 min-w-0 divide-x divide-zinc-200 overflow-x-auto">
          {selected &&
            models.map((m, i) => {
              const c = cells[cellKey(selected, i)];
              return (
                <div key={i} className="flex min-w-[280px] flex-1 flex-col">
                  <div className="flex h-10 items-center gap-1.5 border-b border-zinc-200 bg-white px-3">
                    {i === 0 && <span className="shrink-0 text-[10px] text-zinc-400">current</span>}
                    <ModelPicker
                      value={m}
                      onChange={(v) => setModels((prev) => prev.map((x, j) => (j === i ? v : x)))}
                      disabled={running}
                      showUnconfigured
                      className="min-w-0 text-[11px]"
                    />
                    {i > 0 && (
                      <button
                        onClick={() => setModels((prev) => prev.filter((_, j) => j !== i))}
                        disabled={running}
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
                    <ColumnStats cell={c} />
                    {c?.status === "done" && selected && (
                      golds[selected]?.column === i ? (
                        <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700" title="This transcript is the blessed gold for this scenario">
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
                          className="shrink-0 rounded-md border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-amber-50 hover:text-amber-700"
                          title="Capture this transcript as the gold (blessed reference) for this scenario"
                        >
                          capture gold
                        </button>
                      )
                    )}
                    {i === models.length - 1 && models.length < 6 && (
                      <button
                        onClick={() => setModels((prev) => [...prev, DEFAULT_MODEL_ID])}
                        disabled={running}
                        className="ml-2 shrink-0 rounded-md border border-zinc-200 px-2 py-0.5 text-[12px] font-medium text-zinc-600 hover:bg-zinc-100"
                        title="Add model column"
                      >
                        +
                      </button>
                    )}
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                    {(c?.turns ?? []).map((t, k) => (
                      <TurnBubble key={k} turn={t} />
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

function ColumnStats({ cell }: { cell?: CellState }) {
  if (!cell?.usage) return null;
  const u = cell.usage;
  return (
    <span className="ml-auto whitespace-nowrap text-[10px] text-zinc-500">
      {`${u.inputTokens.toLocaleString()}/${u.outputTokens.toLocaleString()}`}
      {u.cost !== undefined && ` · $${u.cost.toFixed(4)}`}
      {cell.totalMs > 0 && ` · ${(cell.totalMs / 1000).toFixed(1)}s`}
    </span>
  );
}

function TurnBubble({ turn }: { turn: TranscriptTurn }) {
  return turn.role === "user" ? (
    <div className="ml-8 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white">{turn.text}</div>
  ) : (
    <div className="mr-8 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
      {turn.text}
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

