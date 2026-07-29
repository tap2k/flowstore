import { useMemo, useState, useSyncExternalStore } from "react";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import {
  buildReportHtml,
  buildStudyBundle,
  cellKey,
  detectPlaceholders,
  estimateS2sCost,
  estimateVoiceCost,
} from "@flowstore/studies";
import type { CellState, VoiceRates } from "@flowstore/studies";
import {
  CloudArrowDown,
  CloudArrowUp,
  DownloadSimple,
  FileCode,
  Gear,
  Package,
  Plus,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { Button, DropdownMenu, Icon, IconButton, Input, RunButton, StatusIcon, StopButton, Textarea } from "@/components/ui";
import { ModelPicker } from "@/components/runtime/ModelPicker";
import { SettingsSheet } from "@/components/sheets/SettingsSheet";
import { resolveTts, useSettingsStore } from "@/lib/store/settings";
import { downloadBlob } from "@/lib/download";
import { MAX_MODEL_COLUMNS, activeVarsOf, resolveForEngine, useCompareStore } from "./store";
import { isStudyEmpty } from "./studyStorage";
import {
  getOrSynthesizeTurnAudio,
  hasTurnAudio,
  peekTurnAudioUrl,
  subscribeTurnAudio,
  turnAudioVersion,
} from "./audioCache";
import { GitHubStudyOpenModal, GitHubStudySaveModal } from "./GitHubStudyModals";
import { synthesizeSpeech, type ResolvedTts } from "@/lib/runtime/tts";

// The compare tool: paste a prompt, edit scenarios, pick models, run the
// small-N matrix, read the side-by-sides. The engine lives in
// @flowstore/studies (isomorphic), state and behavior in ./store (zustand,
// the editor idiom) — this component only renders.

export function ComparePage() {
  const s = useCompareStore();
  // Cascade voice rates live in the settings store — stack-level facts
  // like the API keys (they describe the user's vendors, not any one study).
  const asrPerMin = useSettingsStore((st) => st.voiceAsrPerMin);
  const ttsPerMChars = useSettingsStore((st) => st.voiceTtsPerMChars);
  const defaultModel = useSettingsStore((st) => st.defaultModel);
  // Subscribed only for reactivity; the resolved dispatch comes from
  // resolveTts() (the store's imperative read, resolveDispatch's sibling).
  useSettingsStore((st) => st.googleApiKey);
  useSettingsStore((st) => st.openaiApiKey);
  useSettingsStore((st) => st.elevenlabsApiKey);
  useSettingsStore((st) => st.ttsProvider);
  useSettingsStore((st) => st.ttsVoice);
  const tts = resolveTts();

  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [githubOpenOpen, setGithubOpenOpen] = useState(false);
  const [githubSaveMode, setGithubSaveMode] = useState<"existing" | "new" | null>(null);

  // Parsed rates; a blank or non-numeric field contributes nothing, and with
  // both blank the voice estimate disappears everywhere.
  const voiceRates = useMemo<VoiceRates>(() => {
    const num = (v: string) => {
      const n = Number(v);
      return v.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
    };
    return { asrPerMin: num(asrPerMin), ttsPerMChars: num(ttsPerMChars) };
  }, [asrPerMin, ttsPerMChars]);

  // Re-render when replay audio arrives or evicts — the cache is a module
  // singleton, not store state (see audioCache.ts).
  useSyncExternalStore(subscribeTurnAudio, turnAudioVersion);
  const placeholders = useMemo(() => detectPlaceholders(s.prompt), [s.prompt]);
  const translateReady = resolveForEngine(defaultModel) !== null;

  const busy = s.runMode !== null;
  const hasResults = Object.keys(s.cells).length > 0;
  const totalCells = s.scenarios.length * s.models.length;
  // Counted over the grid, not the raw cells bag — the bag is pruned on
  // removal now, but the grid is the truth the denominator uses.
  const settledCells = s.scenarios.reduce((acc, sc) => {
    return (
      acc +
      s.models.filter((_, mi) => {
        const c = s.cells[cellKey(sc.id, mi)];
        return c?.status === "done" || c?.status === "error";
      }).length
    );
  }, 0);
  const study = {
    agentId: s.agentId,
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
      'Do you want to run studies like this on your own prompts and agents? Try out the tool — <a href="https://create.flowstore.org/compare">create.flowstore.org/compare</a>. Free, open source, runs in your browser; your prompt never leaves your machine.',
  };

  return (
    <div className="flex h-screen flex-col bg-surface-sunken text-text-primary">
      <header className="flex items-center gap-4 border-b border-border-default bg-surface-panel px-6 py-3">
        {/* Identity block, mirroring the editor's: connected → title + repo
            link; local → brand + the privacy tagline. The wordmark also sits
            bottom-left (BrandMark), matching the editor's canvas. */}
        <div className="flex min-w-0 flex-col">
          {s.github ? (
            <>
              <h1 className="fs-sectionTitle truncate text-text-primary">{s.github.repo}</h1>
              <a
                href={`https://github.com/${s.github.owner}/${s.github.repo}/tree/${s.github.ref}`}
                target="_blank"
                rel="noreferrer"
                title={`${s.github.owner}/${s.github.repo}@${s.github.ref}`}
                className="fs-data truncate leading-tight text-text-tertiary no-underline hover:text-text-primary"
              >
                {s.github.owner}/{s.github.repo}@{s.github.ref}
              </a>
            </>
          ) : (
            <>
              <h1 className="fs-sectionTitle truncate text-text-primary">flowstore</h1>
              <div className="text-[11px] leading-tight text-text-tertiary">
                runs locally in your browser
              </div>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" onClick={() => s.setSetupOpen(!s.setupOpen)}>
            {s.setupOpen ? "hide prompt" : "edit prompt"}
          </Button>
          <Button size="sm" onClick={() => s.clearConversations()} disabled={busy || !hasResults}>
            clear
          </Button>
          {totalCells > 0 && (
            <span
              className="text-[10px] tabular-nums text-text-tertiary"
              title={`${settledCells} of ${totalCells} conversations finished (scenarios × models)`}
            >
              {settledCells}/{totalCells} conversations
            </span>
          )}
          {busy ? (
            <StopButton size="sm" className="shrink-0" onClick={() => s.stopRun()} />
          ) : (
            <RunButton
              size="sm"
              label="Run all — continues stopped conversations and runs missing or failed ones; finished conversations are kept"
              onClick={() => void s.run()}
              disabled={!s.prompt.trim() || s.scenarios.length === 0 || s.models.length === 0}
              className="shrink-0"
            />
          )}
          <Divider />
          {/* Graduation: same-origin jump to the editor, which imports this
              study from localStorage on boot (lib/compareHandoff.ts). */}
          <Button
            size="sm"
            onClick={() => s.openInEditor()}
            disabled={busy || isStudyEmpty(s)}
            title="Open this study in the flow editor — prompt, scenarios, and golds come along"
          >
            open in editor →
          </Button>
          <Divider />
          <IconButton
            icon={CloudArrowDown}
            label="Open a study from GitHub"
            onClick={() => setGithubOpenOpen(true)}
            disabled={busy}
          />
          {/* Same shape as the editor's save cloud (GitHubProjectControls):
              a dropdown of destinations, not a mode toggle inside the modal. */}
          <DropdownMenu
            align="right"
            trigger={
              <IconButton
                icon={CloudArrowUp}
                label="Save study to GitHub"
                disabled={busy || (!s.prompt && s.scenarios.length === 0)}
              />
            }
            items={[
              { label: "Save to an existing repo…", onSelect: () => setGithubSaveMode("existing") },
              { label: "Save to a new repo…", onSelect: () => setGithubSaveMode("new") },
            ]}
          />
          <Divider />
          {/* A label, not an IconButton: it has to wrap the file input to keep
              the native picker one click away. Styled to match IconButton. */}
          <label
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-2 border border-transparent bg-transparent text-text-secondary transition-[background-color,border-color,color] duration-[90ms] ease-standard hover:border-border-default hover:bg-surface-hover active:bg-surface-active"
            title="Upload study (.flowstore.json)"
            aria-label="Upload study"
          >
            <Icon icon={UploadSimple} size={16} />
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && s.uploadBundle(e.target.files[0])}
            />
          </label>
          <DropdownMenu
            align="right"
            open={exportOpen}
            onOpenChange={setExportOpen}
            trigger={
              <IconButton icon={DownloadSimple} label="Export" disabled={!hasResults || busy} />
            }
            items={[
              {
                label: "Export project (.flowstore.json)",
                icon: Package,
                onSelect: () =>
                  downloadBlob(
                    "compare-study.flowstore.json",
                    JSON.stringify(buildStudyBundle(study), null, 2),
                    "application/json",
                  ),
              },
              {
                label: "Download report (HTML)",
                icon: FileCode,
                onSelect: () =>
                  downloadBlob(
                    "compare-report.html",
                    buildReportHtml(study, BROWSER_REPORT_OPTS),
                    "text/html",
                  ),
              },
            ]}
          />
          <IconButton
            icon={Trash}
            label="Clear study"
            onClick={() => {
              if (window.confirm("Clear the whole study? Prompt, scenarios, results, and golds will be removed.")) {
                s.clearStudy();
              }
            }}
            disabled={busy || (!s.prompt && s.scenarios.length === 0 && !hasResults)}
          />
          <Divider />
          <IconButton icon={Gear} label="Settings" onClick={() => setSettingsOpen(true)} />
        </div>
      </header>

      {s.setupOpen && (
        <div className="grid grid-cols-2 border-b border-border-default bg-surface-panel px-4 py-3">
          <div className="flex flex-col pr-4">
            <div className="mb-1 flex h-6 items-center">
              <label className="text-[11px] font-medium text-text-tertiary">
                system prompt
              </label>
            </div>
            <Textarea
              code
              value={s.prompt}
              onChange={(e) => s.setPrompt(e.target.value)}
              className="h-48 w-full resize-y"
            />
            {placeholders.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 flex h-6 items-center justify-between">
                  <span className="text-[11px] font-medium text-text-tertiary">
                    placeholders (filled at send time — the prompt text stays verbatim)
                  </span>
                  <Button
                    size="sm"
                    loading={s.generatingVars}
                    onClick={() => void s.generateVars()}
                    disabled={placeholders.every((n) => (s.vars[n] ?? "").trim())}
                  >
                    {s.generatingVars ? "generating…" : "generate values"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {placeholders.map((name) => (
                    <label
                      key={name}
                      className="flex items-center gap-1.5 rounded border border-border-default py-0.5 pl-1.5 pr-0.5 text-[11px]"
                    >
                      <span className="font-mono text-text-tertiary">{`{{${name}}}`}</span>
                      <Input
                        value={s.vars[name] ?? ""}
                        onChange={(e) => s.setVar(name, e.target.value)}
                        placeholder="value"
                        className="w-32"
                      />
                    </label>
                  ))}
                </div>
                {s.generateVarsError && (
                  <div className="mt-1 text-[10px] text-state-error-fg">{s.generateVarsError}</div>
                )}
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col border-l border-border-subtle pl-4">
            <div className="mb-1 flex h-6 items-center justify-between gap-2">
              <label className="min-w-0 truncate text-[11px] font-medium text-text-tertiary">
                scenarios (one user turn per line)
              </label>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  loading={s.generatingScenarios}
                  onClick={() => void s.generateScenarios()}
                  disabled={!s.prompt.trim()}
                >
                  {s.generatingScenarios ? "generating…" : "generate scenarios"}
                </Button>
                <Button onClick={() => s.addScenario()} size="sm" icon={Plus}>
                  scenario
                </Button>
              </div>
            </div>
            {s.generateScenariosError && (
              <div className="mb-1 text-[10px] text-state-error-fg">{s.generateScenariosError}</div>
            )}

            {/* No box around the list: inputs are already the recessed layer
                (sunken-on-panel, same as the prompt column) — a bordered
                wrapper here reads as a third, redundant surface. */}
            <div className="flex h-48 flex-col gap-3 overflow-y-auto pr-1">
            {s.scenarios.map((sc, i) => (
              <div key={sc.id}>
                <div className="mb-1 flex items-center gap-2">
                  <Input
                    value={sc.name}
                    onChange={(e) => s.updateScenario(i, { name: e.target.value })}
                    className="flex-1"
                  />
                  <Input
                    value={sc.language}
                    onChange={(e) => s.updateScenario(i, { language: e.target.value })}
                    className="w-12"
                    title="language code"
                  />
                  <IconButton
                    icon={X}
                    size="sm"
                    label="Delete scenario"
                    onClick={() => s.removeScenario(i)}
                  />
                </div>
                <Textarea
                  value={sc.turns.join("\n")}
                  onChange={(e) => s.updateScenario(i, { turns: e.target.value.split("\n") })}
                  className="h-16 w-full resize-y"
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
            {/* Same face as the editor's empty canvas (Canvas.tsx) — one
                message line + the pill example button; import lives in the
                toolbar on both surfaces. */}
            <div className="text-sm text-text-tertiary">
              Paste a system prompt above, import a project, or start from the example.
            </div>
            <button
              onClick={() => void s.loadExample()}
              className="rounded-full border border-border-default bg-surface-panel px-4 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-hover"
            >
              load example (clinic agent)
            </button>
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
              {s.scenarios.map((sc) => (
                <tr
                  key={sc.id}
                  onClick={() => s.setSelected(sc.id)}
                  className={`group cursor-pointer hover:bg-surface-hover ${s.selected === sc.id ? "bg-surface-selected" : ""}`}
                >
                  <td className="border-b border-border-subtle px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 break-words">
                        {sc.name} <span className="text-text-disabled">{sc.language}</span>
                        {s.golds[sc.id] && s.golds[sc.id].column === undefined && (
                          <span
                            className="ml-1 text-[9px] text-state-warning-fg"
                            title="An imported blessed gold transcript exists for this scenario"
                          >
                            gold ✓
                          </span>
                        )}
                      </span>
                      {/* Same ▶/■ pair as the header and the simulate strip. */}
                      {s.runMode?.kind === "row" && s.runMode.id === sc.id ? (
                        <StopButton
                          size="sm"
                          className="shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            s.stopRun();
                          }}
                        />
                      ) : (
                        <RunButton
                          size="sm"
                          label={`Run scenario ${sc.name} on all models`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void s.runScenario(sc);
                          }}
                          disabled={busy || !s.prompt.trim() || s.models.length === 0}
                          className="invisible shrink-0 group-hover:visible"
                        />
                      )}
                    </div>
                  </td>
                  <td className="border-b border-l border-border-subtle px-1 py-1.5 text-center">
                    <ScenarioChip cells={s.models.map((_, i) => s.cells[cellKey(sc.id, i)])} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </aside>

        <section className="flex flex-1 min-w-0 divide-x divide-border-default overflow-x-auto">
          {s.selected &&
            s.models.map((m, i) => {
              const key = cellKey(s.selected!, i);
              const c = s.cells[key];
              const colLive = resolveForEngine(m)?.live === true;
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
                  <div className="flex h-10 items-center gap-1.5 border-b border-border-default bg-surface-panel px-3">
                    {i === 0 && <span className="shrink-0 text-[10px] text-text-disabled">current</span>}
                    <ModelPicker
                      value={m}
                      onChange={(v) => s.setModelAt(i, v)}
                      disabled={busy}
                      showUnconfigured
                      includeVoice
                      className="min-w-0 text-[11px]"
                    />
                    {i > 0 && (
                      <IconButton
                        icon={X}
                        size="sm"
                        label="Remove column"
                        onClick={() => s.removeModel(i)}
                        disabled={busy}
                        className="shrink-0"
                      />
                    )}
                    {/* Column ▶/■ — completes the trio with run-all and the
                        scenario rows' ▶: rerun one model across the suite. */}
                    {s.runMode?.kind === "col" && s.runMode.index === i ? (
                      <StopButton size="sm" className="shrink-0" onClick={() => s.stopRun()} />
                    ) : (
                      <RunButton
                        size="sm"
                        label={`Run ${m} on all scenarios — stopped conversations continue; done and failed ones re-run`}
                        onClick={() => void s.runColumn(i)}
                        disabled={busy || s.scenarios.length === 0}
                        className="shrink-0"
                      />
                    )}
                    {c?.divergent && (
                      <span className="rounded-full bg-state-warning-bg px-1.5 text-[9px] text-state-warning-fg">
                        diverges
                      </span>
                    )}
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {translateReady && colTurns.some((t) => t.text) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void s.translateColumn(key, colTurns)}
                        disabled={s.translating !== null}
                        title="Translate this conversation to English. Press again to refresh after new turns; press once more to show originals."
                        className="shrink-0"
                      >
                        🌐 {translateLabel}
                      </Button>
                    )}
                    <ColumnStats cell={c} rates={voiceRates} model={m} live={colLive} />
                    {/* capture-gold disabled for now (Tapan 2026-07-26) — uncomment
                        to restore (store.captureGold); import-side golds and
                        bundle round-trip are unaffected.
                    {c?.status === "done" && s.selected && (
                      s.golds[s.selected]?.column === i ? (
                        <span className="shrink-0 rounded-md bg-state-warning-bg px-1.5 py-0.5 text-[10px] text-state-warning-fg" title="This transcript is the blessed gold for this scenario">
                          gold ✓
                        </span>
                      ) : (
                        <button
                          onClick={() => s.captureGold(s.selected!, i)}
                          className="shrink-0 rounded-md border border-border-default px-1.5 py-0.5 text-[10px] text-text-tertiary hover:bg-state-warning-bg hover:text-state-warning-fg"
                          title="Capture this transcript as the gold (blessed reference) for this scenario"
                        >
                          capture gold
                        </button>
                      )
                    )}
                    */}
                    {i === s.models.length - 1 && (
                      <IconButton
                        icon={Plus}
                        size="sm"
                        label={
                          s.models.length >= MAX_MODEL_COLUMNS
                            ? `${MAX_MODEL_COLUMNS} columns max — compare is the small-N eyeball tool; hand off to the harness for wider matrices`
                            : "Add model column"
                        }
                        onClick={() => s.addModel()}
                        disabled={busy || s.models.length >= MAX_MODEL_COLUMNS}
                        className="shrink-0"
                      />
                    )}
                    </div>
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                    {s.translateErrors[key] && (
                      <div className="text-[10px] text-state-error-fg">{s.translateErrors[key]}</div>
                    )}
                    {colTurns.map((t, k) => (
                      <TurnBubble
                        key={k}
                        turn={t}
                        displayText={s.showTranslated[key] ? s.translations[key]?.get(t.ts) : undefined}
                        audio={audioFor(colLive, t, key, tts)}
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
          onFiles={s.applyBundle}
          onOpened={s.setGithubLocation}
        />
      )}
      {githubSaveMode && (
        <GitHubStudySaveModal
          mode={githubSaveMode}
          onClose={() => setGithubSaveMode(null)}
          onOpenSettings={() => {
            setGithubSaveMode(null);
            setSettingsOpen(true);
          }}
          buildFiles={() => buildStudyBundle(study)}
          onSaved={s.setGithubLocation}
        />
      )}
      {/* Brand wordmark, bottom-left like the editor's canvas BrandMark
          (Canvas.tsx) — same face as the public site's logo. */}
      <span className="pointer-events-none fixed bottom-3 left-4 z-10 select-none font-mono text-base font-semibold tracking-tight text-text-tertiary">
        flowstore
      </span>
    </div>
  );
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

function ColumnStats({
  cell,
  rates,
  model,
  live,
}: {
  cell?: CellState;
  rates: VoiceRates;
  model: string;
  live: boolean;
}) {
  if (!cell?.usage) return null;
  const u = cell.usage;
  const hasAudioTokens = (u.audioInputTokens ?? 0) + (u.audioOutputTokens ?? 0) > 0;
  // S2S column (known from dispatch, not inferred from usage — a live run
  // whose vendor omits token details must not fall into the cascade branch):
  // measured audio tokens × published rates (~, modeled dollars). The
  // cascade estimate never applies here — this column already IS speech.
  const liveEst = live ? estimateS2sCost(u, model) : null;
  // ≈ marks the modeled figure; measured LLM $ stays unprefixed beside it.
  const voice = live ? null : estimateVoiceCost(cell.turns, u.cost, rates);
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
      {hasAudioTokens && (
        <span title="audio tokens in/out (measured)">
          {` · audio ${(u.audioInputTokens ?? 0).toLocaleString()}/${(u.audioOutputTokens ?? 0).toLocaleString()}`}
        </span>
      )}
      {liveEst !== null ? (
        <span title="estimated: measured audio/text tokens × the vendor's published live-API rates">
          {` · ≈${fmt(liveEst)}`}
        </span>
      ) : voice ? (
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
// transcript stays verbatim. audio (s2s replies, session-scoped — see
// audioCache) adds an inline replay control; the WAV builds on first click.
// Which replay control an agent bubble gets: s2s columns replay the run's
// real audio (present in the cache); text columns offer lazy TTS synthesis —
// the cascade side of the ear test — when the chosen vendor's key is set.
function audioFor(
  colLive: boolean,
  t: TranscriptTurn,
  cellKey: string,
  tts: ResolvedTts | null,
): TurnAudio | undefined {
  if (t.role !== "agent") return undefined;
  if (colLive) {
    return hasTurnAudio(cellKey, t.ts) ? { cellKey, ts: t.ts } : undefined;
  }
  if (!t.text || !tts) return undefined;
  const text = t.text;
  return { cellKey, ts: t.ts, synth: () => synthesizeSpeech(text, tts) };
}

type TurnAudio = { cellKey: string; ts: number; synth?: () => Promise<string[]> };

function TurnBubble({
  turn,
  displayText,
  audio,
}: {
  turn: TranscriptTurn;
  displayText?: string;
  audio?: TurnAudio;
}) {
  const shown = displayText ?? turn.text;
  return turn.role === "user" ? (
    <div className="ml-8 rounded-lg bg-emphasis px-3 py-2 text-xs text-emphasis-fg">{shown}</div>
  ) : (
    <div className="mr-8 rounded-lg border border-border-default bg-surface-panel px-3 py-2 text-xs">
      {shown}
      {(turn.latencyMs !== undefined || audio) && (
        <div className="mt-1 flex items-center gap-2 text-[10px] text-text-disabled">
          {turn.latencyMs !== undefined && <span>{(turn.latencyMs / 1000).toFixed(1)}s</span>}
          {audio && <ReplayButton cellKey={audio.cellKey} ts={audio.ts} synth={audio.synth} />}
        </div>
      )}
    </div>
  );
}

// Replay a spoken s2s reply. One module-level element and one source of
// truth for what's playing (the URL), published through a tiny external
// store — every button derives its own playing state from it, so starting a
// reply reliably flips the previous button back to "hear" (columns would
// cacophony otherwise, and HTMLAudioElement pause events arrive async).
const replay = (() => {
  const el = typeof Audio !== "undefined" ? new Audio() : null;
  let playingUrl: string | null = null;
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((cb) => cb());
  if (el) el.onended = el.onpause = () => {
    playingUrl = null;
    notify();
  };
  return {
    subscribe: (cb: () => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    playingUrl: () => playingUrl,
    toggle: (url: string) => {
      if (!el) return;
      if (playingUrl === url) {
        el.pause();
        return;
      }
      el.src = url;
      playingUrl = url;
      notify();
      void el.play();
    },
  };
})();

function ReplayButton({
  cellKey,
  ts,
  synth,
}: {
  cellKey: string;
  ts: number;
  // Text columns only: synthesize the reply (the user's ear-test TTS vendor)
  // on first click and cache it like an s2s recording. s2s columns replay
  // the run's real audio and never synthesize. In-flight dedupe lives in the
  // cache (getOrSynthesize), not here — a second click or a second render of
  // the same turn must never double-bill.
  synth?: () => Promise<string[]>;
}) {
  const playingUrl = useSyncExternalStore(replay.subscribe, replay.playingUrl);
  // Self-sufficient cache subscription (don't rely on the page's) — memoize
  // a column and this still updates.
  useSyncExternalStore(subscribeTurnAudio, turnAudioVersion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // peek never builds — the WAV encode happens on click only.
  const playing = playingUrl !== null && peekTurnAudioUrl(cellKey, ts) === playingUrl;
  // Audio already in the cache → the click is free (replay). Otherwise the
  // label says "tts" so the cost of the click is legible before clicking.
  const cached = hasTurnAudio(cellKey, ts);
  const onClick = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const u = await getOrSynthesizeTurnAudio(cellKey, ts, synth ?? (() => Promise.reject(new Error("No audio for this reply."))));
      if (u) replay.toggle(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "TTS failed.");
    } finally {
      setBusy(false);
    }
  };
  const state = busy ? "synth" : playing ? "playing" : error ? "error" : cached ? "cached" : "new";
  const TITLES = {
    synth: "Synthesizing…",
    playing: "Stop",
    error: error ?? "TTS failed.",
    cached: "Hear this reply (already generated — free to replay)",
    new: "Synthesize and hear this reply — your ear-test TTS vendor (settings), then kept for this session",
  } as const;
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      title={TITLES[state]}
      className={`cursor-pointer ${state === "error" ? "text-state-error-fg" : "text-text-tertiary hover:text-text-primary"}`}
    >
      {state === "synth" ? (
        <span className="inline-flex items-center gap-1">
          <StatusIcon status="running" size={11} />
          tts…
        </span>
      ) : state === "playing" ? (
        "◼ stop"
      ) : state === "error" ? (
        "✕ tts"
      ) : state === "cached" ? (
        "▶ hear"
      ) : (
        "▶ tts"
      )}
    </button>
  );
}

// Toolbar group separator, matching the editor toolbar's Divider.
function Divider() {
  return <span className="mx-1 h-5 w-px bg-border-subtle" aria-hidden="true" />;
}
