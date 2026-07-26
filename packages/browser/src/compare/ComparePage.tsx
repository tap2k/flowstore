import { useState } from "react";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import { genId } from "@flowstore/core/ids";
import { IDLE_CELL, buildReportHtml, buildStudyBundle, cellKey, runMatrix } from "@flowstore/studies";
import type { CellState, Scenario } from "@flowstore/studies";
import { ModelPicker } from "@/components/runtime/ModelPicker";
import { DEFAULT_MODEL_ID, resolveDispatch, useSettingsStore } from "@/lib/store/settings";
import { downloadBlob } from "@/lib/download";
import { DEMO_PROMPT, DEMO_SCENARIOS } from "@/compare/demoContent";

// The compare tool: paste a prompt, edit scenarios, pick models, run the
// small-N matrix, read the side-by-sides. The engine lives in
// @flowstore/studies (isomorphic); this page is the browser surface — it
// resolves credentials and renders state.

export function ComparePage() {
  const [prompt, setPrompt] = useState(DEMO_PROMPT);
  const [scenarios, setScenarios] = useState<Scenario[]>(DEMO_SCENARIOS);
  const [models, setModels] = useState<string[]>([DEFAULT_MODEL_ID, DEFAULT_MODEL_ID]);
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [selected, setSelected] = useState<string | null>(scenarios[0]?.id ?? null);
  const [monthly, setMonthly] = useState(30000);
  const [running, setRunning] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);

  const googleApiKey = useSettingsStore((s) => s.googleApiKey);
  const openrouterApiKey = useSettingsStore((s) => s.openrouterApiKey);
  const setGoogleApiKey = useSettingsStore((s) => s.setGoogleApiKey);
  const setOpenrouterApiKey = useSettingsStore((s) => s.setOpenrouterApiKey);

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

  const hasResults = Object.keys(cells).length > 0;
  const study = {
    title: "Model comparison study",
    prompt,
    models,
    scenarios,
    cells,
    monthlyConversations: monthly,
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
          <h1 className="truncate text-lg font-semibold leading-tight text-zinc-900">compare</h1>
          <div className="text-[11px] leading-tight text-zinc-500">
            flowstore · runs locally in your browser
          </div>
        </div>
        <button
          onClick={() => setSetupOpen((v) => !v)}
          className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-[11px] hover:bg-zinc-50"
        >
          {setupOpen ? "hide setup" : "edit setup"}
        </button>
        <div className="ml-auto flex items-center gap-3">
          <KeyField label="google" value={googleApiKey} onChange={setGoogleApiKey} />
          <KeyField label="openrouter" value={openrouterApiKey} onChange={setOpenrouterApiKey} />
          {hasResults && !running && (
            <>
              <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                conv/mo
                <input
                  type="number"
                  value={monthly}
                  onChange={(e) => setMonthly(Number(e.target.value) || 0)}
                  className="w-20 rounded border border-zinc-300 px-1.5 py-1 text-[11px]"
                />
              </label>
              <button
                onClick={() =>
                  downloadBlob(
                    "compare-report.html",
                    buildReportHtml(study, BROWSER_REPORT_OPTS),
                    "text/html",
                  )
                }
                className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
              >
                report
              </button>
              <button
                onClick={() =>
                  downloadBlob(
                    "compare-study.flowstore.json",
                    JSON.stringify(buildStudyBundle(study), null, 2),
                    "application/json",
                  )
                }
                className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
                title="A flowstore project bundle — the harness runs it, the editor opens it"
              >
                export study
              </button>
            </>
          )}
          <button
            onClick={run}
            disabled={running || scenarios.length === 0 || models.length === 0}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {running ? "running…" : "run"}
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

      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2">
        {models.map((m, i) => (
          <div key={i} className="flex items-center gap-1">
            <ModelPicker
              value={m}
              onChange={(v) => setModels((prev) => prev.map((x, j) => (j === i ? v : x)))}
              disabled={running}
              showUnconfigured
              className="text-xs"
            />
            {i === 0 ? (
              <span className="rounded-full border border-zinc-300 px-1.5 text-[9px] text-zinc-500">
                current
              </span>
            ) : (
              <button
                onClick={() => setModels((prev) => prev.filter((_, j) => j !== i))}
                disabled={running}
                className="text-[11px] text-zinc-400 hover:text-red-600"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {models.length < 6 && (
          <button
            onClick={() => setModels((prev) => [...prev, DEFAULT_MODEL_ID])}
            disabled={running}
            className="rounded-full border border-zinc-300 px-3 py-1 text-[11px] hover:bg-zinc-50"
          >
            + model
          </button>
        )}
        <span className="ml-auto text-[10px] text-zinc-400">
          first model = your current one (the comparison baseline)
        </span>
      </div>

      <main className="flex flex-1 min-h-0">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-zinc-50">
              <tr>
                <th className="border-b border-zinc-200 px-2 py-1.5 text-left font-medium">
                  scenario
                </th>
                {models.map((m, i) => (
                  <th
                    key={i}
                    className="border-b border-l border-zinc-200 px-1 py-1.5 text-center font-medium"
                    title={m}
                  >
                    {i === 0 ? "cur" : `m${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={`cursor-pointer hover:bg-zinc-50 ${selected === s.id ? "bg-zinc-100" : ""}`}
                >
                  <td className="border-b border-zinc-100 px-2 py-1.5">
                    {s.name} <span className="text-zinc-400">{s.language}</span>
                  </td>
                  {models.map((_, i) => {
                    const c = cells[cellKey(s.id, i)];
                    return (
                      <td key={i} className="border-b border-l border-zinc-100 px-1 py-1.5 text-center">
                        <CellChip cell={c} />
                      </td>
                    );
                  })}
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
                  <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-1.5">
                    <span className="truncate text-[11px] font-medium">{m}</span>
                    {c?.divergent && (
                      <span className="rounded-full bg-amber-100 px-1.5 text-[9px] text-amber-800">
                        diverges
                      </span>
                    )}
                    <ColumnStats cell={c} />
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
    </div>
  );

  function updateScenario(i: number, patch: Partial<Scenario>) {
    setScenarios((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }
}

function CellChip({ cell }: { cell?: CellState }) {
  if (!cell || cell.status === "idle") return <span className="text-zinc-300">·</span>;
  if (cell.status === "running") return <span className="text-zinc-400">…</span>;
  if (cell.status === "error") return <span className="text-red-600">✕</span>;
  return cell.divergent ? (
    <span className="text-amber-600" title="diverges from current model — read it">
      ▲
    </span>
  ) : (
    <span className="text-emerald-600">✓</span>
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

function KeyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return value ? (
    <span className="text-[10px] text-zinc-400">{label} ✓</span>
  ) : (
    <input
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`${label} API key`}
      className="w-36 rounded border border-zinc-300 px-2 py-1 text-[11px]"
    />
  );
}
