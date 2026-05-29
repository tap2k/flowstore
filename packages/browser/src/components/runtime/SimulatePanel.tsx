import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSpecStore, type Selection } from "@/lib/store/spec";
import type { Spec } from "@flowstore/core/schema/v0";
import { resolveDispatch, useSettingsStore } from "@/lib/store/settings";
import {
  useSimulateStore,
  type SimulateMode,
  type TranscriptTurn,
} from "@/lib/store/simulate";
import { formatErrors, validateSpec } from "@flowstore/core/validation/ajv";
import type { RuntimeEvent } from "@flowstore/core/runtime/eventTypes";
import { formatEvent, formatValueTruncated } from "@flowstore/core/runtime/formatEvent";
import { translateBatchToEnglish } from "@flowstore/core/runtime/translate";
import { ModelPicker } from "./ModelPicker";
import { ScenarioForm } from "./ScenarioForm";
import { PersonaForm } from "./PersonaForm";
import { PersonasPanel } from "./PersonasPanel";
import { GoldsPanel } from "./GoldsPanel";
import { ScenariosPanel } from "./ScenariosPanel";
import { TestsPanel } from "./TestsPanel";
import { useUiStore } from "@/lib/store/ui";
import { useTestsStore } from "@/lib/store/tests";
import type { TestCase } from "@flowstore/core/schema/files/testCase";
import type { Gold } from "@flowstore/core/schema/files/gold";
import { evaluateCaseAgainstTranscript, type CaseVerdicts } from "@/lib/caseVerdicts";
import { judgeRubric, type RubricVerdict } from "@flowstore/core/runtime/judgeRubric";
import type { Rubric } from "@flowstore/core/schema/files/rubric";

interface SimulatePanelProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function SimulatePanel({ open, onClose, onOpenSettings }: SimulatePanelProps) {
  const model = useSettingsStore((s) => s.simulateAgentModel);
  const dispatch = resolveDispatch(model);
  const apiKey = dispatch.apiKey;
  // Translate uses Gemini structured output; needs the Google key
  // specifically (not whichever provider the picker is on).
  const googleApiKey = useSettingsStore((s) => s.googleApiKey);
  const setSimulateAgentModel = useSettingsStore((s) => s.setSimulateAgentModel);
  const personaModel = useSettingsStore((s) => s.simulatePersonaModel);
  const setSimulatePersonaModel = useSettingsStore((s) => s.setSimulatePersonaModel);
  const judgeModel = useSettingsStore((s) => s.simulateJudgeModel);
  const setSimulateJudgeModel = useSettingsStore((s) => s.setSimulateJudgeModel);
  const runnerUrl = useSettingsStore((s) => s.runnerUrl);
  const mode = useSimulateStore((s) => s.mode);
  const sessionId = useSimulateStore((s) => s.sessionId);
  const status = useSimulateStore((s) => s.status);
  const transcript = useSimulateStore((s) => s.transcript);
  const events = useSimulateStore((s) => s.events);
  const variables = useSimulateStore((s) => s.variables);
  const contextVars = useSimulateStore((s) => s.contextVars);
  const mockReturns = useSimulateStore((s) => s.mockReturns);
  const currentFlowId = useSimulateStore((s) => s.currentFlowId);
  const systemPrompt = useSimulateStore((s) => s.systemPrompt);
  const specSnapshot = useSimulateStore((s) => s.specSnapshot);
  const lastUsage = useSimulateStore((s) => s.lastUsage);
  const error = useSimulateStore((s) => s.error);
  const setMode = useSimulateStore((s) => s.setMode);
  const start = useSimulateStore((s) => s.start);
  const send = useSimulateStore((s) => s.send);
  const reset = useSimulateStore((s) => s.reset);
  const fork = useSimulateStore((s) => s.fork);
  const hydrateContextVars = useSimulateStore((s) => s.hydrateContextVars);
  const hydrateMockReturns = useSimulateStore((s) => s.hydrateMockReturns);
  const hydratePersona = useSimulateStore((s) => s.hydratePersona);
  const autoRun = useSimulateStore((s) => s.autoRun);
  const autoStepping = useSimulateStore((s) => s.autoStepping);
  const autoStep = useSimulateStore((s) => s.autoStep);
  const openSimulateTab = useUiStore((s) => s.openSimulateTab);
  const setOpenSimulateTab = useUiStore((s) => s.setOpenSimulateTab);
  const saveCase = useTestsStore((s) => s.saveCase);
  const saveGold = useTestsStore((s) => s.saveGold);
  const uniqueCaseId = useTestsStore((s) => s.uniqueCaseId);
  const uniqueGoldId = useTestsStore((s) => s.uniqueGoldId);
  const setCaptureContext = useTestsStore((s) => s.setCaptureContext);
  const allCases = useTestsStore((s) => s.cases);
  const allRubrics = useTestsStore((s) => s.rubrics);
  const allGolds = useTestsStore((s) => s.golds);
  const activeCaseId = useSimulateStore((s) => s.activeCaseId);
  const setActiveCaseId = useSimulateStore((s) => s.setActiveCaseId);
  const activeCase = activeCaseId
    ? allCases.find((c) => c.id === activeCaseId) ?? null
    : null;
  const [isRunning, setIsRunning] = useState(false);
  // Set by the Stop button; the run loop checks before each `send()` and
  // breaks. An in-flight LLM call still completes (we can't abort the
  // network round-trip mid-stream); stop takes effect on the next turn
  // boundary — same UX as the persona-driven autoRun loop.
  const stopRequestedRef = useRef(false);
  // Rubric verdicts for the current run, populated on completion by
  // judgeRubric() — one entry per bound rubric. Cleared at the start of
  // each run.
  const [rubricVerdicts, setRubricVerdicts] = useState<
    Record<string, RubricVerdict | "pending">
  >({});
  const verdicts: CaseVerdicts = evaluateCaseAgainstTranscript(
    activeCase,
    transcript,
    !isRunning && transcript.length > 0,
  );

  const [input, setInput] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);
  const [translations, setTranslations] = useState<Map<number, string>>(new Map());
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const spec = useSpecStore((s) => s.spec);
  const availableLanguages = spec?.agent.meta.languages ?? [];
  const language = useSimulateStore((s) => s.language);
  const setLanguage = useSimulateStore((s) => s.setLanguage);
  const hasCapabilities = (spec?.agent.capabilities?.length ?? 0) > 0;
  // Scenarios tab is always available — vars + mocks are co-located there
  // regardless of whether the spec declares any capabilities.

  // Default is "all" (undefined) — emit every language bucket. Reset to "all"
  // when the active agent changes, or when the current selection is no longer
  // in the new agent's language list. Done during render to avoid a wasted
  // commit cycle.
  const prevAgentIdRef = useRef<string | undefined>(spec?.agent.id);
  if (prevAgentIdRef.current !== spec?.agent.id) {
    prevAgentIdRef.current = spec?.agent.id;
    if (language !== undefined) setLanguage(undefined);
  } else if (language !== undefined && !availableLanguages.includes(language)) {
    setLanguage(undefined);
  }

  // Capture "was at bottom" before the new turn renders (layout effect runs
  // before paint; a plain effect would see the already-grown scrollHeight and
  // think the user had scrolled up). Only auto-scroll if they were pinned to
  // the bottom; otherwise let them stay where they were reading.
  const wasAtBottomRef = useRef(true);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = distanceFromBottom < 32;
  });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!wasAtBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript, status]);

  useEffect(() => {
    if (open && spec) {
      hydrateContextVars(spec.agent.id);
      hydrateMockReturns(spec.agent.id);
      hydratePersona(spec.agent.id);
    }
  }, [open, spec, hydrateContextVars, hydrateMockReturns, hydratePersona]);

  // Clear translation state when sessionId changes. Done during render via the
  // "adjusting state on prop change" pattern rather than in an effect to avoid
  // a wasted render cycle.
  const prevSessionIdRef = useRef(sessionId);
  if (prevSessionIdRef.current !== sessionId) {
    prevSessionIdRef.current = sessionId;
    setTranslations(new Map());
    setShowTranslated(false);
    setTranslateError(null);
  }

  useEffect(() => {
    if (!autoRun) return;
    // No session yet — bootstrap one. The "ready" branch below picks up after start() resolves.
    if (!sessionId && status === "idle") {
      startSession();
      return;
    }
    if (status !== "ready") return;
    if (autoStepping) return;
    if (!sessionId) return;
    autoStep();
    // startSession is defined below in the component closure and reads from refs/state at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, status, autoStepping, sessionId, transcript.length, autoStep]);

  if (!open) return null;

  const busy = status === "thinking" || status === "starting";
  const ended = status === "ended";
  const ready = status === "ready";
  // After a failed turn the session is still alive, so let the user type and
  // retry. Start failures have no session, so the input isn't rendered at all
  // (EmptyState's "Start session" handles that retry instead).
  const canSend = ready || status === "error";

  async function startSession() {
    const current = useSpecStore.getState().spec;
    if (!current) return;
    const v = validateSpec(current);
    if (!v.valid) {
      setValidationErrors(formatErrors(v.errors).slice(0, 10));
      return;
    }
    setValidationErrors(null);
    await start({
      mode,
      spec: current,
      apiKey,
      // wireModel — what gets sent to the LLM API. Catalog key (model) and
      // wire id differ when the entry sets model_id (Claude on OpenRouter).
      model: dispatch.wireModel,
      provider: dispatch.provider,
      baseUrl: mode === "runner" ? runnerUrl : dispatch.baseUrl,
      language,
    });
  }

  async function onReset() {
    await reset();
    setInput("");
    setValidationErrors(null);
  }

  async function runActiveCase() {
    if (!activeCase || isRunning) return;
    setIsRunning(true);
    stopRequestedRef.current = false;
    // Clear any prior rubric verdicts — judging is now manual via the
    // summary block's "Judge rubrics" button.
    setRubricVerdicts({});
    try {
      if (hasSession) await reset();
      await startSession();
      // startSession may have errored (no spec / no key); bail if so.
      if (useSimulateStore.getState().status === "error") return;
      if (activeCase.user_turns && activeCase.user_turns.length > 0) {
        for (const turn of activeCase.user_turns) {
          if (stopRequestedRef.current) break;
          const s = useSimulateStore.getState().status;
          if (s === "ended" || s === "error") break;
          await send(turn);
        }
      } else if (activeCase.persona_id) {
        // Persona-driven: kick the existing autoRun loop. The persona
        // prompt was already loaded into the buffer by Open in Sim ▶;
        // we just enable autoRun and let the existing autoStep machinery
        // play through.
        useSimulateStore.getState().setAutoRun(true);
        // For persona-driven runs we can't await completion here — the
        // loop is driven by an effect elsewhere. Skip rubric judging in
        // that branch for now; it can be triggered separately when the
        // autoRun finishes (follow-up).
        return;
      }
    } finally {
      setIsRunning(false);
      stopRequestedRef.current = false;
    }

    // Don't auto-judge — the user clicks "Judge rubrics" in the summary
    // block when they're ready. Clear out any "pending" markers we set
    // above so the block doesn't show a stuck spinner.
    setRubricVerdicts({});
  }

  async function judgeBoundRubrics() {
    if (!activeCase) return;
    const boundIds = (activeCase.evaluators ?? []).filter((id) =>
      allRubrics.some((r) => r.id === id),
    );
    if (boundIds.length === 0) return;
    if (!googleApiKey) {
      setRubricVerdicts(
        Object.fromEntries(
          boundIds.map((id) => [
            id,
            {
              score: null,
              notes:
                "judge skipped — no Google API key configured (rubric judging uses Gemini structured output)",
            } satisfies RubricVerdict,
          ]),
        ),
      );
      return;
    }
    setRubricVerdicts(
      Object.fromEntries(boundIds.map((id) => [id, "pending" as const])),
    );
    const goldRecord = activeCase.gold_id
      ? allGolds.find((g) => g.id === activeCase.gold_id) ?? null
      : null;
    const finalTranscript = useSimulateStore.getState().transcript;
    await Promise.all(
      boundIds.map(async (id) => {
        const rubric = allRubrics.find((r) => r.id === id);
        if (!rubric) return;
        const verdict = await judgeRubric({
          rubric,
          transcript: finalTranscript.map((t) => ({ role: t.role, text: t.text })),
          gold: goldRecord,
          apiKey: googleApiKey,
          model: judgeModel,
        });
        setRubricVerdicts((prev) => ({ ...prev, [id]: verdict }));
      }),
    );
  }

  function stopActiveCase() {
    if (!isRunning) return;
    stopRequestedRef.current = true;
    // Persona-driven cases run via the existing autoRun loop; the
    // canonical way to halt that loop is setAutoRun(false). For
    // scripted cases the flag above handles it.
    useSimulateStore.getState().setAutoRun(false);
  }

  function onCaptureCase() {
    if (transcript.length === 0) return;
    // Auto-name; user renames in the Tests-tab editor (step 5). Per the
    // editor-test-loop-mvp doc, captured cases are always `source:
    // scripted`, even when the originating session was persona-driven —
    // the persona's generated user-turns become deterministic text.
    // persona_id is NOT carried over; designers who want re-explore-each-
    // run behavior re-load the persona manually in Simulate.
    const defaultName = `Captured case ${useTestsStore.getState().cases.length + 1}`;
    const id = uniqueCaseId(defaultName);
    const user_turns = transcript
      .filter((t) => t.role === "user")
      .map((t) => t.text);
    const testCase: TestCase = {
      $schema: "flowstore://test/case/v0",
      id,
      name: defaultName,
      user_turns,
    };
    saveCase(testCase);
    // Pin the just-captured full transcript so the Tests-tab editor (step
    // 5) can render the agent+user reference panel for assertion authoring.
    setCaptureContext({ caseId: id, transcript });
    setOpenSimulateTab("tests");
  }

  function onCaptureGold() {
    if (transcript.length === 0) return;
    // Auto-name; no gold editor exists in v1, so renaming requires
    // hand-editing the JSON file. Document path in the toast.
    const defaultName = `Captured gold ${useTestsStore.getState().golds.length + 1}`;
    const id = uniqueGoldId(defaultName);
    const turns = transcript
      .filter((t) => t.text.trim().length > 0)
      .map((t) => ({ role: t.role, text: t.text }));
    const gold: Gold = {
      $schema: "flowstore://test/gold/v0",
      id,
      name: defaultName,
      turns,
    };
    saveGold(gold);
    window.alert(
      `Saved gold to tests/gold/${id}.gold.json. Rename via Claude Code / GitHub web UI.`,
    );
  }

  function onDownload() {
    const current = useSpecStore.getState().spec;
    const payload = {
      exported_at: new Date().toISOString(),
      spec: current,
      session: { id: sessionId, status, current_flow_id: currentFlowId },
      system_prompt: systemPrompt,
      transcript,
      events,
      variables,
      context_vars: contextVars,
      mock_returns: mockReturns,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const agentId = current?.agent.id ?? "unknown";
    const shortId = sessionId ? sessionId.slice(0, 8) : "nosess";
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flowstore-trace-${agentId}-${shortId}-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onSend() {
    if (busy || ended || !canSend) return;
    const text = input;
    setInput("");
    await send(text);
    // A failed turn rolls itself back in the store and leaves status "error".
    // Put the text back so the user can fix and resend without retyping.
    if (useSimulateStore.getState().status === "error") setInput(text);
  }

  function onForkTurn(turnIndex: number, originalText: string) {
    fork(turnIndex);
    setInput(originalText);
    // Defer the focus so the textarea has re-enabled (we just flipped status
    // out of "ended" → "ready"), and to land after React's commit.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(originalText.length, originalText.length);
    });
  }

  const uncachedTurns = transcript.filter(
    (t) => t.text && !translations.has(t.ts),
  );

  async function onTranslate() {
    if (uncachedTurns.length === 0 && showTranslated) {
      setShowTranslated(false);
      return;
    }
    setTranslating(true);
    setTranslateError(null);
    try {
      if (uncachedTurns.length > 0) {
        const result = await translateBatchToEnglish(
          uncachedTurns.map((t) => ({ id: String(t.ts), text: t.text })),
          googleApiKey,
          "gemini-2.5-flash",
        );
        setTranslations((prev) => {
          const next = new Map(prev);
          for (const [id, eng] of Object.entries(result)) {
            next.set(Number(id), eng);
          }
          return next;
        });
      }
      setShowTranslated(true);
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : String(e));
    } finally {
      setTranslating(false);
    }
  }

  const translateLabel = translating
    ? "…"
    : showTranslated && uncachedTurns.length === 0
      ? "show original"
      : "translate";
  const translateVisible = !!googleApiKey && transcript.some((t) => t.text);

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    }
  }

  const hasSession = sessionId !== null;
  const specChanged = specSnapshot !== null && spec !== null && spec !== specSnapshot;
  const subtitle = (() => {
    if (status === "starting") return "starting…";
    if (status === "thinking") return "thinking…";
    if (status === "ended") return "ended";
    if (status === "error") return "error";
    if (status === "ready") return "ready";
    return "idle";
  })();

  return (
    <aside className="flex flex-col h-full w-[380px] border-l border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900 truncate">
            Run
          </div>
          <div className="text-[11px] text-zinc-500 truncate">
            {mode === "prompt" && lastUsage
              ? `${subtitle} · ${lastUsage.inputTokens.toLocaleString()} in / ${lastUsage.outputTokens.toLocaleString()} out`
              : currentFlowId
                ? `${subtitle} · ${currentFlowId}`
                : subtitle}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {hasSession && (
            <>
              <button
                onClick={onDownload}
                title="Download the full trace (spec snapshot, transcript, events, variables) as JSON."
                className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100"
              >
                download
              </button>
              {transcript.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    e.target.value = "";
                    if (v === "case") onCaptureCase();
                    else if (v === "gold") onCaptureGold();
                  }}
                  title="Capture the current transcript as a test case (saved + opened in Tests tab) or a gold (verbatim reference)."
                  className="rounded border border-transparent bg-transparent px-1 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 cursor-pointer"
                >
                  <option value="" disabled>capture ▾</option>
                  <option value="case">as test case</option>
                  <option value="gold">as gold</option>
                </select>
              )}
              <button
                onClick={onReset}
                disabled={busy}
                title="End the current session and start fresh against the same spec — even if the agent didn't end it."
                className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
              >
                reset
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100"
          >
            close
          </button>
        </div>
      </div>

      <div className="flex border-b border-zinc-200 text-[11px]">
        <TabButton active={openSimulateTab === "simulate"} onClick={() => setOpenSimulateTab("simulate")}>
          Simulate
        </TabButton>
        {import.meta.env.VITE_DEV && (
          <TabButton active={openSimulateTab === "tests"} onClick={() => setOpenSimulateTab("tests")}>
            Tests
          </TabButton>
        )}
        <TabButton active={openSimulateTab === "personas"} onClick={() => setOpenSimulateTab("personas")}>
          Personas
        </TabButton>
        <TabButton active={openSimulateTab === "golds"} onClick={() => setOpenSimulateTab("golds")}>
          Golds
        </TabButton>
        {import.meta.env.VITE_DEV && (
          <TabButton active={openSimulateTab === "scenarios"} onClick={() => setOpenSimulateTab("scenarios")}>
            Scenarios
          </TabButton>
        )}
      </div>

      {openSimulateTab === "personas" && <PersonasPanel />}

      {openSimulateTab === "golds" && <GoldsPanel />}

      {openSimulateTab === "scenarios" && import.meta.env.VITE_DEV && <ScenariosPanel />}

      {openSimulateTab === "tests" && import.meta.env.VITE_DEV && <TestsPanel />}

      {openSimulateTab === "simulate" && (
        <>
      {activeCase && (
        <ActiveCaseStrip
          testCase={activeCase}
          isRunning={isRunning}
          hasSession={hasSession}
          busy={busy}
          verdicts={verdicts}
          onRun={() => void runActiveCase()}
          onStop={stopActiveCase}
          onUnload={() => setActiveCaseId(null)}
        />
      )}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-1.5 text-[11px]">
        {runnerUrl && (
          <div className="flex overflow-hidden rounded border border-zinc-200">
            <ModeButton current={mode} value="prompt" disabled={hasSession} onClick={setMode}>
              Prompt
            </ModeButton>
            <ModeButton current={mode} value="runner" disabled={hasSession} onClick={setMode}>
              Runner
            </ModeButton>
          </div>
        )}
        <ModelPicker
          value={model}
          onChange={setSimulateAgentModel}
          disabled={hasSession}
          title={
            mode === "runner"
              ? "Model id sent to the runner — the runner may override it."
              : "Model the agent uses in prompt mode"
          }
          className="truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-zinc-500 hover:text-zinc-900 hover:border-zinc-200 disabled:opacity-60 cursor-pointer disabled:cursor-default"
          // Runner mode shows everything: the runner may have its own keys.
          showUnconfigured={mode === "runner"}
        />
        {availableLanguages.length > 1 && (
          <select
            value={language ?? ""}
            onChange={(e) => setLanguage(e.target.value || undefined)}
            disabled={hasSession}
            title="Scope scripts and FAQ to a single language, or emit all. Locked once a session is running."
            className="ml-auto rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <option value="">all</option>
            {availableLanguages.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Scenario subsumes vars + per-cap mocks: load picks the world for
          the next run; vars/mocks are inline in the Scenarios tab. */}
      {spec && <ScenarioForm spec={spec} disabled={busy || ready} />}

      {hasSession && mode === "prompt" && specChanged && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          Spec changed since session start. Reset to re-render the system prompt.
        </div>
      )}

      {spec && <PersonaForm disabled={false} />}

      <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3 text-sm">
        {!hasSession && status !== "starting" && (
          <EmptyState
            mode={mode}
            apiKey={apiKey}
            providerLabel={providerLabelFor(dispatch.endpoint)}
            specLoaded={!!spec}
            validationErrors={validationErrors}
            onStart={startSession}
            onOpenSettings={onOpenSettings}
          />
        )}
        {transcript.map((t, i) => {
          // Per-turn assertions index against the agent-only subsequence
          // (turn 1 = first agent turn). Compute the agent index of this
          // turn so we can pull matching verdicts to render inline.
          const agentIndex =
            t.role === "agent"
              ? transcript.slice(0, i + 1).filter((x) => x.role === "agent").length
              : null;
          const turnVerdicts =
            activeCase && agentIndex !== null
              ? (activeCase.assertions ?? [])
                  .map((a, idx) => ({
                    assertion: a,
                    verdict: verdicts.perTurn.find((v) => v.index === idx),
                  }))
                  .filter((row) => row.assertion.turn === agentIndex)
              : [];
          return (
            <div key={i} className="space-y-1">
              <TurnView
                turn={t}
                index={i}
                spec={spec}
                displayText={showTranslated ? translations.get(t.ts) : undefined}
                onFork={mode === "prompt" ? onForkTurn : undefined}
              />
              {turnVerdicts.map((row, ri) => {
                const v = row.verdict;
                const pending = v?.verdict === "pending" || !v;
                const ok = v?.verdict === "pass";
                return (
                  <div
                    key={`v-${ri}`}
                    className={`ml-6 text-[10px] ${
                      pending
                        ? "text-zinc-400"
                        : ok
                          ? "text-emerald-700"
                          : "text-red-700"
                    }`}
                  >
                    {pending ? "…" : ok ? "✓" : "✗"}{" "}
                    {row.assertion.must_contain && row.assertion.must_contain.length > 0 && (
                      <span>contains "{row.assertion.must_contain.join(`", "`)}"</span>
                    )}
                    {row.assertion.must_not_contain && row.assertion.must_not_contain.length > 0 && (
                      <span>
                        {row.assertion.must_contain ? " · " : ""}
                        ¬contains "{row.assertion.must_not_contain.join(`", "`)}"
                      </span>
                    )}
                    {v?.reason && <span className="text-zinc-500"> — {v.reason}</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
        {busy && hasSession && (
          <div className="text-xs text-zinc-500 italic">thinking…</div>
        )}
        {activeCase && hasSession && transcript.length > 0 && (
          <TranscriptAssertionsCard testCase={activeCase} verdicts={verdicts} />
        )}
        {activeCase && hasSession && transcript.length > 0 && (
          <RubricsCard
            testCase={activeCase}
            rubrics={allRubrics}
            rubricVerdicts={rubricVerdicts}
            judgeModel={judgeModel}
            onJudgeModelChange={setSimulateJudgeModel}
            onJudgeRubrics={() => void judgeBoundRubrics()}
            judging={Object.values(rubricVerdicts).some((v) => v === "pending")}
            // Rubrics judge the *final* transcript. While the run is in
            // progress or an LLM call is mid-flight the transcript is
            // incomplete, so the button stays disabled until things
            // settle. Designers can still re-judge later by clicking again.
            canJudge={!isRunning && !busy}
          />
        )}
        {hasSession && transcript.length > 0 && !busy && !isRunning && (
          <div className="flex items-center justify-end gap-1 pt-1">
            <button
              type="button"
              onClick={onCaptureCase}
              title="Capture this transcript as a new test case."
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-[10px] text-zinc-700 hover:bg-zinc-50"
            >
              + capture as case
            </button>
            <button
              type="button"
              onClick={onCaptureGold}
              title="Save this transcript verbatim as a gold (reference conversation)."
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-[10px] text-zinc-700 hover:bg-zinc-50"
            >
              + capture as gold
            </button>
          </div>
        )}
      </div>

      {error && status === "error" && (
        <div className="flex items-start justify-between gap-2 border-t border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
          <span>{error}</span>
          {hasSession && (
            <button
              onClick={onReset}
              disabled={busy}
              title="End this session and start fresh against the same spec."
              className="shrink-0 rounded border border-red-300 bg-white px-2 py-0.5 text-red-700 hover:bg-red-100 disabled:opacity-40"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {translateError && (
        <div className="flex items-start justify-between gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <span>Translate failed: {translateError}</span>
          <button
            onClick={() => setTranslateError(null)}
            className="rounded px-1 text-amber-800 hover:bg-amber-100"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {hasSession && !ended && (
        <div className="border-t border-zinc-200 p-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type as the user… (⌘↵ to send)"
            disabled={busy || !canSend}
            rows={3}
            className="w-full resize-none rounded border border-zinc-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 disabled:bg-zinc-50"
          />
          <div className="mt-1 flex items-center justify-between">
            {translateVisible ? (
              <button
                onClick={onTranslate}
                disabled={translating}
                title="Translate agent and user messages to English using Gemini. Press again to refresh after new turns; press once more to show originals."
                className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
              >
                🌐 {translateLabel}
              </button>
            ) : (
              <span />
            )}
            <button
              onClick={onSend}
              disabled={busy || !canSend}
              title={input.trim() ? "Send" : "Send empty user message"}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {ended && (
        <div className="border-t border-zinc-200 px-3 py-2 flex items-center justify-between gap-2 text-[11px] text-zinc-600">
          <span>Session ended.</span>
          <div className="flex items-center gap-2">
            {translateVisible && (
              <button
                onClick={onTranslate}
                disabled={translating}
                title="Translate agent and user messages to English using Gemini."
                className="rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
              >
                🌐 {translateLabel}
              </button>
            )}
            <button
              onClick={onReset}
              className="rounded bg-zinc-900 px-2 py-1 text-white hover:bg-zinc-700"
            >
              Reset
            </button>
          </div>
        </div>
      )}
        </>
      )}
    </aside>
  );
}

function ActiveCaseStrip({
  testCase,
  isRunning,
  hasSession,
  busy,
  verdicts,
  onRun,
  onStop,
  onUnload,
}: {
  testCase: TestCase;
  isRunning: boolean;
  hasSession: boolean;
  busy: boolean;
  verdicts: CaseVerdicts;
  onRun: () => void;
  onStop: () => void;
  onUnload: () => void;
}) {
  const totalAssertions =
    (testCase.assertions?.length ?? 0) +
    (testCase.transcript_assertions?.length ?? 0) +
    (testCase.state_assertions?.length ?? 0);
  const rubricCount = testCase.evaluators?.length ?? 0;
  return (
    <div className="border-b border-zinc-200 bg-amber-50/60 px-3 py-1.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-zinc-900">
            Active case: {testCase.name || testCase.id}
          </div>
          <div className="truncate text-[10px] text-zinc-600">
            {testCase.persona_id
              ? `persona · ${testCase.persona_id}`
              : `scripted · ${testCase.user_turns?.length ?? 0} turns`}{" "}
            · {totalAssertions} assertion{totalAssertions === 1 ? "" : "s"}
            {rubricCount > 0 && (
              <>
                {" · "}
                {rubricCount} rubric{rubricCount === 1 ? "" : "s"}
              </>
            )}
            {hasSession && verdicts.evaluable > 0 && (
              <>
                {" · "}
                <span className="font-mono">
                  {verdicts.passed}/{verdicts.evaluable}
                </span>{" "}
                {verdicts.failed > 0 ? "✗" : verdicts.pending > 0 ? "…" : "✓"}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isRunning ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop case"
              className="rounded border border-red-300 bg-red-50 px-2 py-1 text-[12px] font-medium text-red-700 hover:bg-red-100"
              title="Stop. Any in-flight LLM call still completes; the loop halts on the next turn."
            >
              ■
            </button>
          ) : (
            <button
              type="button"
              onClick={onRun}
              disabled={busy}
              aria-label={hasSession ? "Re-run case" : "Run case"}
              className="rounded bg-zinc-900 px-2 py-1 text-[12px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
              title={
                hasSession
                  ? "Re-run case against the current spec."
                  : "Run case against the current spec."
              }
            >
              {hasSession ? "↻" : "▶"}
            </button>
          )}
          <button
            type="button"
            onClick={onUnload}
            disabled={isRunning}
            aria-label="Unload case"
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-[12px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            title="Unload the active case binding (variables/persona/mocks stay loaded)."
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

function TranscriptAssertionsCard({
  testCase,
  verdicts,
}: {
  testCase: TestCase;
  verdicts: CaseVerdicts;
}) {
  // Per-turn verdicts render inline under each agent turn; this card
  // shows only the transcript-level assertion status. Status color is
  // based on the transcript-level verdicts alone, not aggregated with
  // per-turn (which are already visible inline).
  const items = testCase.transcript_assertions ?? [];
  if (items.length === 0) return null;
  const passed = verdicts.transcript.filter((v) => v.verdict === "pass").length;
  const failed = verdicts.transcript.filter((v) => v.verdict === "fail").length;
  const pending = items.length - passed - failed;
  const status = failed > 0 ? "FAIL" : pending > 0 ? "RUNNING" : "PASS";
  const color =
    status === "FAIL"
      ? "border-red-200 bg-red-50 text-red-900"
      : status === "PASS"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div className={`rounded border ${color} p-2 text-[11px] space-y-1`}>
      <div className="font-medium">
        {status === "FAIL" ? "✗" : status === "PASS" ? "✓" : "…"} transcript ·{" "}
        {passed}/{items.length}
      </div>
      {items.map((ta, i) => {
        const v = verdicts.transcript.find((p) => p.index === i);
        const ok = v?.verdict === "pass";
        const pendingTurn = v?.verdict === "pending";
        return (
          <div key={`tr-${i}`} className="text-[10px]">
            {pendingTurn ? "…" : ok ? "✓" : "✗"} {ta.kind}
            {ta.pattern && <> "{ta.pattern}"</>}
            {v?.reason && <span className="text-zinc-600"> — {v.reason}</span>}
          </div>
        );
      })}
    </div>
  );
}

function RubricsCard({
  testCase,
  rubrics,
  rubricVerdicts,
  judgeModel,
  onJudgeModelChange,
  onJudgeRubrics,
  judging,
  canJudge,
}: {
  testCase: TestCase;
  rubrics: Rubric[];
  rubricVerdicts: Record<string, RubricVerdict | "pending">;
  judgeModel: string;
  onJudgeModelChange: (m: string) => void;
  onJudgeRubrics: () => void;
  judging: boolean;
  canJudge: boolean;
}) {
  const evaluatorIds = (testCase.evaluators ?? []).filter((id) =>
    rubrics.some((r) => r.id === id),
  );
  if (evaluatorIds.length === 0) return null;
  const scored = evaluatorIds.filter((id) => {
    const v = rubricVerdicts[id];
    return v !== undefined && v !== "pending" && v.score !== null;
  }).length;
  return (
    <div className="rounded border border-zinc-200 bg-white p-2 text-[11px] space-y-1">
      <div className="font-medium text-zinc-900">
        rubrics · {scored}/{evaluatorIds.length} scored
      </div>
      {evaluatorIds.map((id) => {
        const rubric = rubrics.find((r) => r.id === id);
        if (!rubric) return null;
        const v = rubricVerdicts[id];
        const pending = v === "pending";
        const unrun = v === undefined;
        const errored = !pending && !unrun && v.score === null;
        const label = rubric.name || rubric.id;
        return (
          <div key={`ev-${id}`} className="text-[10px]">
            {pending ? "…" : unrun ? "○" : errored ? "⚠" : "•"} {label}
            {!pending && !unrun && v.score !== null && (
              <span className="font-mono">
                {" · "}
                {v.score}/{rubric.scale?.max ?? 5}
              </span>
            )}
            {!pending && !unrun && (
              <span className="text-zinc-600"> — {v.notes}</span>
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-2 pt-1 text-[10px] text-zinc-600">
        <span>judge:</span>
        <ModelPicker
          value={judgeModel}
          onChange={onJudgeModelChange}
          className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
        />
        <button
          type="button"
          onClick={onJudgeRubrics}
          disabled={judging || !canJudge}
          className="ml-auto rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
          title={
            !canJudge
              ? "Wait for the conversation to finish — rubrics judge the final transcript."
              : "Score each bound rubric with the judge LLM."
          }
        >
          {judging ? "judging…" : "Judge rubrics"}
        </button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-1.5 text-center ${
        active
          ? "border-b-2 border-zinc-900 font-medium text-zinc-900"
          : "border-b-2 border-transparent text-zinc-500 hover:text-zinc-900"
      }`}
    >
      {children}
    </button>
  );
}

function ModeButton({
  current,
  value,
  disabled,
  onClick,
  children,
}: {
  current: SimulateMode;
  value: SimulateMode;
  disabled: boolean;
  onClick: (m: SimulateMode) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      onClick={() => onClick(value)}
      disabled={disabled}
      className={`px-2 py-0.5 text-[11px] ${
        active
          ? "bg-zinc-900 text-white"
          : "bg-white text-zinc-600 hover:bg-zinc-50"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

function EmptyState({
  mode,
  apiKey,
  providerLabel,
  specLoaded,
  validationErrors,
  onStart,
  onOpenSettings,
}: {
  mode: SimulateMode;
  apiKey: string;
  providerLabel: string;
  specLoaded: boolean;
  validationErrors: string[] | null;
  onStart: () => void;
  onOpenSettings: () => void;
}) {
  if (!specLoaded) {
    return (
      <div className="text-xs text-zinc-500">
        Load a spec to start simulating.
      </div>
    );
  }
  return (
    <div className="text-xs text-zinc-500 space-y-4">
      {mode === "prompt" && !apiKey && (
        <p>
          <button onClick={onOpenSettings} className="underline hover:text-zinc-900">
            Requires a {providerLabel} API key in Settings.
          </button>
        </p>
      )}
      {validationErrors && validationErrors.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-red-800">
          <div className="font-medium mb-1">Spec has validation errors:</div>
          <ul className="list-disc pl-4 space-y-0.5 font-mono text-[10px]">
            {validationErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <button
        onClick={onStart}
        disabled={mode === "prompt" && !apiKey}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Start session
        {mode === "runner" && !apiKey && (
          <span className="ml-1 opacity-70">(runner credentials)</span>
        )}
      </button>
    </div>
  );
}

function TurnView({
  turn,
  index,
  spec,
  displayText,
  onFork,
}: {
  turn: TranscriptTurn;
  index: number;
  spec: Spec | null;
  displayText?: string;
  onFork?: (turnIndex: number, originalText: string) => void;
}) {
  const { role, text, events } = turn;
  const shown = displayText ?? text;
  // [begin] is the synthetic opener for chatbot_initiates prompt sessions —
  // not a real user turn, so it can't be forked.
  const isOpener = text === "[begin]";
  const canFork = !!onFork && role === "user" && !isOpener;

  if (role === "user") {
    // Empty input is sent verbatim — render a muted placeholder so the empty
    // bubble doesn't look broken, while making clear the model saw nothing.
    const isEmpty = text === "";
    return (
      <div className="space-y-1">
        <div className="group flex justify-end items-start gap-1.5">
          {canFork && (
            <button
              type="button"
              onClick={() => onFork!(index, text)}
              title="Fork: rewind to this turn and try a different message"
              className="mt-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-900 group-hover:opacity-100 focus:opacity-100"
            >
              ↺ fork
            </button>
          )}
          <div className="max-w-[85%] rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white whitespace-pre-wrap">
            {isEmpty ? <span className="italic text-zinc-400">(empty user message)</span> : shown}
          </div>
        </div>
        {events.map((ev, i) => (
          <EventLine key={i} ev={ev} spec={spec} />
        ))}
      </div>
    );
  }

  // The runner emits exit_path_taken / flow_exited after the agent's utterance,
  // when routing for the next turn is decided. Use the first one as the boundary:
  // events before it set up the utterance, events from it on describe routing.
  let splitIdx = events.findIndex(
    (ev) => ev.type === "exit_path_taken" || ev.type === "flow_exited",
  );
  if (splitIdx < 0) splitIdx = events.length;
  const preEvents = events.slice(0, splitIdx);
  const postEvents = events.slice(splitIdx);

  return (
    <div className="space-y-1">
      {preEvents.map((ev, i) => (
        <EventLine key={`pre-${i}`} ev={ev} spec={spec} />
      ))}
      <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900 whitespace-pre-wrap">
        {text ? shown : <span className="italic text-zinc-400">(no text returned)</span>}
      </div>
      {turn.latencyMs !== undefined && (
        <div className="text-[10px] text-zinc-400">{formatLatency(turn.latencyMs)}</div>
      )}
      {postEvents.map((ev, i) => (
        <EventLine key={`post-${i}`} ev={ev} spec={spec} />
      ))}
    </div>
  );
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Routing events map to a node or edge on the canvas. Other events have no
// canvas target — render them as the plain-text disclosure they were before.
function selectionForEvent(ev: RuntimeEvent, spec: Spec | null): Selection {
  if (!spec) return null;
  const flowExists = (id: string) => spec.flows.some((f) => f.id === id);
  const edgeExists = (flowId: string, exitPathId: string) =>
    spec.flows
      .find((f) => f.id === flowId)
      ?.exit_paths.some((xp) => xp.id === exitPathId) ?? false;

  switch (ev.type) {
    case "flow_entered":
      return flowExists(ev.flow_id) ? { kind: "flow", id: ev.flow_id } : null;
    case "flow_exited":
      // flow_exited is hidden in the rendered list (formatEvent returns null),
      // but include it for completeness if that ever changes.
      if (ev.exit_path_id && edgeExists(ev.flow_id, ev.exit_path_id)) {
        return { kind: "edge", flowId: ev.flow_id, exitPathId: ev.exit_path_id };
      }
      return flowExists(ev.flow_id) ? { kind: "flow", id: ev.flow_id } : null;
    case "exit_path_taken":
      if (edgeExists(ev.from_flow_id, ev.exit_path_id)) {
        return { kind: "edge", flowId: ev.from_flow_id, exitPathId: ev.exit_path_id };
      }
      // Spec was edited mid-session and the exit path is gone — fall back to
      // the source flow so the click still lands somewhere meaningful.
      return flowExists(ev.from_flow_id) ? { kind: "flow", id: ev.from_flow_id } : null;
    case "interrupt_triggered":
      return flowExists(ev.interrupt_flow_id)
        ? { kind: "flow", id: ev.interrupt_flow_id }
        : null;
    default:
      return null;
  }
}

function EventLine({ ev, spec }: { ev: RuntimeEvent; spec: Spec | null }) {
  const setSelection = useSpecStore((s) => s.setSelection);
  const line = formatEvent(ev, formatValueTruncated);
  if (!line) return null;
  const target = selectionForEvent(ev, spec);

  return (
    <details className="px-1 text-[10px] font-mono text-zinc-400 hover:text-zinc-600">
      <summary className="cursor-pointer list-none">
        <span className="text-zinc-300">→ </span>
        {target ? (
          <button
            type="button"
            onClick={(e) => {
              // Don't toggle the disclosure when the user is jumping to canvas.
              e.preventDefault();
              e.stopPropagation();
              setSelection(target);
            }}
            className="text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900"
            title="Select on canvas"
          >
            {line}
          </button>
        ) : (
          line
        )}
      </summary>
      <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-[10px] text-zinc-500">
        {JSON.stringify(ev, null, 2)}
      </pre>
    </details>
  );
}

function providerLabelFor(endpoint: ReturnType<typeof resolveDispatch>["endpoint"]): string {
  switch (endpoint) {
    case "google": return "Google";
    case "openai": return "OpenAI";
    case "openrouter": return "OpenRouter";
    case "openai-compatible": return "OpenAI-compatible";
    default: return "provider";
  }
}

