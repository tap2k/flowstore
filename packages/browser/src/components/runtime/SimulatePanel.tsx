import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSpecStore, type Selection } from "@/lib/store/spec";
import type { Spec } from "@flowstore/core/schema/v0";
import { DEFAULT_MODEL_ID, resolveDispatch, useSettingsStore } from "@/lib/store/settings";
import { useModelsStore } from "@/lib/store/models";
import { BUILT_IN_MODELS } from "@flowstore/core/files/models";
import {
  isPromptMode,
  PROMPT_MODE_BEGIN,
  useSimulateStore,
  type SimulateMode,
  type SimulateStatus,
  type TranscriptTurn,
} from "@/lib/store/simulate";
import type { VoicePhase } from "@/lib/runtime/voiceSession";
import { formatErrors, validateSpec } from "@flowstore/core/validation/ajv";
import type { RuntimeEvent } from "@flowstore/core/runtime/eventTypes";
import { formatEvent, formatValueTruncated } from "@flowstore/core/runtime/formatEvent";
import { translateBatchToEnglish } from "@flowstore/core/runtime/translate";
import { ModelPicker } from "./ModelPicker";
import { PersonaForm } from "./PersonaForm";
import { PersonasPanel } from "./PersonasPanel";
import { GoldsPanel } from "./GoldsPanel";
import { TestsPanel } from "./TestsPanel";
import { useUiStore } from "@/lib/store/ui";
import { useTestsStore } from "@/lib/store/tests";
import type { TestCase } from "@flowstore/core/schema/files/testCase";
import type { Gold } from "@flowstore/core/schema/files/gold";
import { evaluateCaseAgainstTranscript, type CaseVerdicts } from "@/lib/caseVerdicts";
import { judgeRubric, type RubricVerdict } from "@flowstore/core/runtime/judgeRubric";
import { judgeGuardrails, type GuardrailVerdict } from "@flowstore/core/runtime/judgeGuardrails";
import { judgeGoldTurn, type GoldTurnVerdict } from "@flowstore/core/runtime/judgeGoldTurn";
import type { Rubric } from "@flowstore/core/schema/files/rubric";
import type { AgentEndpoint } from "@flowstore/core/files/models";

// Stable empty fallback so Zustand selector never returns a new {} reference.
const NO_AGENTS: Record<string, AgentEndpoint> = {};

interface SimulatePanelProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function SimulatePanel({ open, onClose, onOpenSettings }: SimulatePanelProps) {
  const mode = useSimulateStore((s) => s.mode);
  const agentModel = useSettingsStore((s) => s.simulateAgentModel);
  const voiceModel = useSettingsStore((s) => s.simulateVoiceModel);
  const setSimulateVoiceModel = useSettingsStore((s) => s.setSimulateVoiceModel);
  const configuredAgents = useModelsStore((s) => s.config?.agents ?? NO_AGENTS);
  // The agent model is provider-locked to Gemini Live in voice mode; the two
  // pickers and their dispatch are kept separate (see settings.simulateVoiceModel).
  const model = mode === "voice" ? voiceModel : agentModel;
  const dispatch = resolveDispatch(model);
  const apiKey = dispatch.apiKey;
  // Translate uses Gemini structured output; needs the Google key
  // specifically (not whichever provider the picker is on).
  const googleApiKey = useSettingsStore((s) => s.googleApiKey);
  const setSimulateAgentModel = useSettingsStore((s) => s.setSimulateAgentModel);
  const simulateAttribution = useSettingsStore((s) => s.simulateAttribution);
  const setSimulateAttribution = useSettingsStore((s) => s.setSimulateAttribution);
  // Voice (Live) models 404 via generateContent; if one leaked into the agent slot, snap back.
  // Done during render to match the language-reset guard below.
  if (BUILT_IN_MODELS.models[agentModel]?.voice) {
    setSimulateAgentModel(DEFAULT_MODEL_ID);
  }
  const judgeModel = useSettingsStore((s) => s.simulateJudgeModel);
  const setSimulateJudgeModel = useSettingsStore((s) => s.setSimulateJudgeModel);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const runnerUrl = useSettingsStore((s) => s.runnerUrl);
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
  const voicePhase = useSimulateStore((s) => s.voicePhase);
  const micMuted = useSimulateStore((s) => s.micMuted);
  const setMicMuted = useSimulateStore((s) => s.setMicMuted);
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
  const setPendingCaseId = useTestsStore((s) => s.setPendingCaseId);
  const setSelectedGoldId = useTestsStore((s) => s.setSelectedGoldId);
  const allCases = useTestsStore((s) => s.cases);
  const allRubrics = useTestsStore((s) => s.rubrics);
  const allGolds = useTestsStore((s) => s.golds);
  const activeCaseId = useSimulateStore((s) => s.activeCaseId);
  const setActiveCaseId = useSimulateStore((s) => s.setActiveCaseId);
  const activeCase = activeCaseId
    ? allCases.find((c) => c.id === activeCaseId) ?? null
    : null;
  const activeGoldId = useSimulateStore((s) => s.activeGoldId);
  const setActiveGoldId = useSimulateStore((s) => s.setActiveGoldId);
  const activeGold = activeGoldId
    ? allGolds.find((g) => g.id === activeGoldId) ?? null
    : null;
  // Agent turns from the active gold, aligned by index for inline gold-vs-live comparison.
  const goldAgentTurns = activeGold
    ? activeGold.turns.filter((t) => t.role === "agent").map((t) => t.text)
    : [];
  const [isRunning, setIsRunning] = useState(false);
  // Set by Stop button; checked before each send(). In-flight LLM calls complete first.
  const stopRequestedRef = useRef(false);
  // Lives in simulate store (not local state) so ChatPanel can read; cleared on each new turn.
  const rubricVerdicts = useSimulateStore((s) => s.rubricVerdicts);
  const setRubricVerdicts = useSimulateStore((s) => s.setRubricVerdicts);
  const patchRubricVerdict = useSimulateStore((s) => s.patchRubricVerdict);
  // Holistic guardrail/business-goal verdict for the current transcript.
  const guardrailVerdict = useSimulateStore((s) => s.guardrailVerdict);
  const setGuardrailVerdict = useSimulateStore((s) => s.setGuardrailVerdict);
  // Per-agent-turn semantic verdicts for the active gold (null = not yet run).
  const goldTurnVerdicts = useSimulateStore((s) => s.goldTurnVerdicts);
  const setGoldTurnVerdicts = useSimulateStore((s) => s.setGoldTurnVerdicts);
  const patchGoldTurnVerdict = useSimulateStore((s) => s.patchGoldTurnVerdict);
  const [evaluating, setEvaluating] = useState(false);
  const verdicts: CaseVerdicts = evaluateCaseAgainstTranscript(
    activeCase,
    transcript,
    !isRunning && transcript.length > 0,
  );

  const [input, setInput] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);
  // Tracks which external agent is selected (key in configuredAgents). Only
  // meaningful when mode === "external".
  const [selectedAgentId, setSelectedAgentId] = useState<string>(() => Object.keys(configuredAgents)[0] ?? "");
  const [translations, setTranslations] = useState<Map<number, string>>(new Map());
  const [goldTranslations, setGoldTranslations] = useState<Map<number, string>>(new Map());
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const spec = useSpecStore((s) => s.spec);
  const availableLanguages = spec?.agent.meta.languages ?? [];
  const language = useSimulateStore((s) => s.language);
  const setLanguage = useSimulateStore((s) => s.setLanguage);

  // Default is undefined ("auto"): the prompt renders in the default language
  // and voice auto-detects, following the caller per turn. Reset to auto when
  // the active agent changes, or when the current selection is no longer in
  // the new agent's language list. Done during render to avoid a wasted
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

  // Reset translation state on new session (adjusting-state-on-prop-change avoids extra render).
  const prevSessionIdRef = useRef(sessionId);
  if (prevSessionIdRef.current !== sessionId) {
    prevSessionIdRef.current = sessionId;
    setTranslations(new Map());
    setShowTranslated(false);
    setTranslateError(null);
  }

  // Reset gold translations when the active gold changes.
  const prevGoldIdRef = useRef(activeGoldId);
  if (prevGoldIdRef.current !== activeGoldId) {
    prevGoldIdRef.current = activeGoldId;
    setGoldTranslations(new Map());
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
  // Failed turns can still retry (session alive); start failures skip the input entirely.
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
    const selectedAgent = mode === "external"
      ? Object.entries(configuredAgents).map(([id, ep]) => ({ id, ...ep })).find(
          (a) => a.id === selectedAgentId
        ) ?? null
      : null;
    await start({
      mode,
      spec: current,
      apiKey,
      model: dispatch.wireModel,
      provider: dispatch.provider,
      baseUrl: mode === "runner" ? runnerUrl : dispatch.baseUrl,
      language,
      agentEntry: selectedAgent ?? undefined,
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
          // A turn may be a voice barge-in object; the editor's Simulate plays
          // its text (barge-in truncation is a --voice harness concern).
          await send(typeof turn === "string" ? turn : turn.text);
        }
      } else if (activeCase.persona_id || activeCase.system_prompt) {
        // Actor-driven: the prompt was hydrated by Open in Sim ▶ (persona base
        // + any inline overlay); just enable autoRun and let autoStep play through.
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

  // Replay a gold's user turns through the live agent. A gold is a coupled
  // reference transcript; the only side we can feed an agent is the user
  // turns, exactly like a scripted case. The gold's agent turns are then
  // shown inline beneath each live agent bubble (GoldTurnRef) as a
  // deterministic drift check. Divergence at turn N means later user turns
  // (which answered the gold's agent turns) no longer fit, so the inline
  // refs degrade after the first divergence — which is itself the signal.
  async function runGold() {
    if (!activeGold || isRunning) return;
    const goldUserTurns = activeGold.turns
      .filter((t) => t.role === "user")
      .map((t) => t.text);
    if (goldUserTurns.length === 0) return;
    setIsRunning(true);
    stopRequestedRef.current = false;
    try {
      if (hasSession) await reset();
      await startSession();
      if (useSimulateStore.getState().status === "error") return;
      for (const turn of goldUserTurns) {
        if (stopRequestedRef.current) break;
        const s = useSimulateStore.getState().status;
        if (s === "ended" || s === "error") break;
        await send(turn);
      }
    } finally {
      setIsRunning(false);
      stopRequestedRef.current = false;
    }
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
    const finalTranscript = useSimulateStore.getState().transcript;
    await Promise.all(
      boundIds.map(async (id) => {
        const rubric = allRubrics.find((r) => r.id === id);
        if (!rubric) return;
        const judgeDispatch = resolveDispatch(judgeModel);
        if (!judgeDispatch.provider || !judgeDispatch.apiKey) return;
        const verdict = await judgeRubric({
          rubric,
          transcript: finalTranscript.map((t) => ({ role: t.role, text: t.text })),
          provider: judgeDispatch.provider,
          apiKey: judgeDispatch.apiKey,
          model: judgeDispatch.wireModel,
        });
        patchRubricVerdict(id, verdict);
      }),
    );
  }

  async function evaluate() {
    if (evaluating) return;
    const current = useSpecStore.getState().spec;
    if (!current) return;
    const guardrails = (current.agent.guardrails ?? [])
      .map((g) => g.statement?.trim())
      .filter((s): s is string => !!s);
    // No early return on empty guardrails: the judge still checks
    // hallucination grounding, which is universal.
    const judgeDispatch = resolveDispatch(judgeModel);
    if (!judgeDispatch.provider || !judgeDispatch.apiKey) {
      setGuardrailVerdict({
        status: "skipped",
        summary: `judge skipped — no API key configured for "${judgeModel}" (pick a Google or OpenAI model).`,
        verdict: "pass",
        failure_mode: "none",
        failure_turns: [],
        guardrails: [],
        hallucinations: [],
      });
      return;
    }
    // Both are non-null: the early-return guard above ensures this, but we
    // capture them here so closures below see narrowed (non-nullable) types.
    const { provider, apiKey, wireModel } = judgeDispatch as {
      provider: NonNullable<typeof judgeDispatch.provider>;
      apiKey: string;
      wireModel: string;
    };
    setEvaluating(true);
    setGuardrailVerdict(null);
    try {
      const finalTranscript = useSimulateStore.getState().transcript;
      const liveAgentTurns = finalTranscript.filter((t) => t.role === "agent");

      // Run guardrails and (if a gold is active) semantic turn comparison in parallel.
      const promises: Promise<void>[] = [];

      promises.push(
        judgeGuardrails({
          guardrails,
          systemPrompt: useSimulateStore.getState().systemPrompt,
          transcript: finalTranscript.map((t) => ({ role: t.role, text: t.text })),
          provider,
          apiKey,
          model: wireModel,
        }).then(setGuardrailVerdict),
      );

      if (activeGold && liveAgentTurns.length > 0) {
        const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
        // Seed pending verdicts for diverged turns only (exact matches need no LLM call).
        const initialVerdicts: Record<number, GoldTurnVerdict | "pending"> = {};
        liveAgentTurns.forEach((turn, idx) => {
          const goldText = goldAgentTurns[idx];
          if (goldText !== undefined && norm(goldText) !== norm(turn.text)) {
            initialVerdicts[idx] = "pending";
          }
        });
        setGoldTurnVerdicts(initialVerdicts);

        promises.push(
          ...Object.keys(initialVerdicts).map(async (idxStr) => {
            const idx = Number(idxStr);
            const goldText = goldAgentTurns[idx]!;
            const liveText = liveAgentTurns[idx].text;
            const verdict = await judgeGoldTurn({
              goldTurn: goldText,
              liveTurn: liveText,
              provider,
              apiKey,
              model: wireModel,
            });
            patchGoldTurnVerdict(idx, verdict);
          }),
        );
      }

      await Promise.all(promises);
    } finally {
      setEvaluating(false);
    }
  }

  function stopActiveCase() {
    // isRunning covers scripted replay; autoRun covers the persona-driven loop
    // (where isRunning has already flipped back to false). Either means "stop".
    if (!isRunning && !useSimulateStore.getState().autoRun) return;
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
      .filter((t) => t.role === "user" && t.text !== PROMPT_MODE_BEGIN)
      .map((t) => t.text);
    const testCase: TestCase = {
      $schema: "flowstore://test/case/v0",
      id,
      name: defaultName,
      user_turns,
    };
    saveCase(testCase);
    setPendingCaseId(id);
    setOpenSimulateTab("tests");
  }

  function onCaptureGold() {
    if (transcript.length === 0) return;
    // Auto-name; user renames in the Golds-tab editor (mirrors case
    // capture). Open the new gold inline there so the save is self-
    // evident — no blocking alert needed.
    const defaultName = `Captured gold ${useTestsStore.getState().golds.length + 1}`;
    const id = uniqueGoldId(defaultName);
    const turns = transcript
      .filter((t) => t.text.trim().length > 0 && t.text !== PROMPT_MODE_BEGIN)
      .map((t) => ({ role: t.role, text: t.text }));
    const gold: Gold = {
      $schema: "flowstore://test/gold/v0",
      id,
      name: defaultName,
      turns,
    };
    saveGold(gold);
    setSelectedGoldId(id);
    setOpenSimulateTab("golds");
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
  const uncachedGoldItems = activeGold
    ? goldAgentTurns
        .map((text, idx) => ({ idx, text }))
        .filter(({ idx }) => !goldTranslations.has(idx))
    : [];
  const hasUncached = uncachedTurns.length > 0 || uncachedGoldItems.length > 0;

  async function onTranslate() {
    // Self-guard against re-entry, mirroring evaluate / runActiveCase.
    // Both translate buttons are disabled while in flight, but that's React
    // state (stale within a tick); this keeps the invariant on the handler.
    if (translating) return;
    if (!hasUncached && showTranslated) {
      setShowTranslated(false);
      return;
    }
    setTranslating(true);
    setTranslateError(null);
    try {
      if (hasUncached) {
        const items = [
          ...uncachedTurns.map((t) => ({ id: String(t.ts), text: t.text })),
          ...uncachedGoldItems.map(({ idx, text }) => ({ id: `gold:${idx}`, text })),
        ];
        const result = await translateBatchToEnglish(items, googleApiKey, defaultModel);
        setTranslations((prev) => {
          const next = new Map(prev);
          for (const [id, eng] of Object.entries(result)) {
            if (!id.startsWith("gold:")) next.set(Number(id), eng);
          }
          return next;
        });
        setGoldTranslations((prev) => {
          const next = new Map(prev);
          for (const [id, eng] of Object.entries(result)) {
            if (id.startsWith("gold:")) next.set(Number(id.slice(5)), eng);
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
    : showTranslated && !hasUncached
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
            {mode === "voice" && hasSession
              ? `${subtitle}${voicePhase && voicePhase !== "idle" ? ` · ${voicePhase}` : ""}`
              : isPromptMode(mode) && lastUsage
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
              <button
                onClick={onReset}
                title="End the current session and start fresh against the same spec — even if the agent didn't end it."
                className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100"
              >
                clear
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
        <TabButton active={openSimulateTab === "tests"} onClick={() => setOpenSimulateTab("tests")}>
          Tests
        </TabButton>
        <TabButton active={openSimulateTab === "personas"} onClick={() => setOpenSimulateTab("personas")}>
          Personas
        </TabButton>
        <TabButton active={openSimulateTab === "golds"} onClick={() => setOpenSimulateTab("golds")}>
          Golds
        </TabButton>
      </div>

      {openSimulateTab === "personas" && <PersonasPanel />}

      {openSimulateTab === "golds" && <GoldsPanel />}

      {openSimulateTab === "tests" && <TestsPanel />}

      {openSimulateTab === "simulate" && (
        <>
      {activeCase && (
        <ActiveCaseStrip
          testCase={activeCase}
          // A persona-driven case runs via the store's autoRun loop, not the
          // local isRunning flag (runActiveCase hands off and returns). Fold
          // autoRun in so the strip shows ■ and its Stop works for that path.
          isRunning={isRunning || ((!!activeCase.persona_id || !!activeCase.system_prompt) && autoRun)}
          hasSession={hasSession}
          busy={busy}
          verdicts={verdicts}
          onRun={() => void runActiveCase()}
          onStop={stopActiveCase}
          onUnload={() => setActiveCaseId(null)}
        />
      )}
      {activeGold && (
        <ActiveGoldStrip
          gold={activeGold}
          isRunning={isRunning}
          hasSession={hasSession}
          busy={busy}
          onRun={() => void runGold()}
          onStop={stopActiveCase}
          onUnload={() => setActiveGoldId(null)}
        />
      )}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-1.5 text-[11px]">
        <select
          value={mode === "external" ? `external:${selectedAgentId}` : mode}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith("external:")) {
              const id = v.slice("external:".length);
              setSelectedAgentId(id);
              setMode("external");
            } else {
              setMode(v as SimulateMode);
            }
          }}
          disabled={hasSession}
          title="Simulation mode. Text and Voice run browser-direct (prompt mode); Runner drives the Python runtime; External drives a configured agent endpoint. Locked once a session is running."
          className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          <option value="text">Text</option>
          <option value="voice">Voice</option>
          {runnerUrl && <option value="runner">Runner</option>}
          {Object.entries(configuredAgents).map(([id, ep]) => (
            <option key={id} value={`external:${id}`}>{ep.name ?? id}</option>
          ))}
        </select>
        {mode === "voice" ? (
          <ModelPicker
            value={model}
            onChange={setSimulateVoiceModel}
            disabled={hasSession}
            title="Gemini Live model for voice mode (voice is Gemini-only)."
            className="truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-zinc-500 hover:text-zinc-900 hover:border-zinc-200 disabled:opacity-60 cursor-pointer disabled:cursor-default"
            voiceOnly
          />
        ) : mode !== "external" ? (
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
            showUnconfigured={mode === "runner"}
          />
        ) : null}
        {mode === "text" && (
          <label
            title="Animate the canvas during simulation — one small LLM call per agent turn (default model) lights the current flow, transitions, and off-spec jumps. Turn off to save a call per turn (rate-limited keys, persona batch runs)."
            className="flex items-center gap-1 text-[11px] text-zinc-700 cursor-pointer select-none"
          >
            <input
              type="checkbox"
              checked={simulateAttribution}
              onChange={(e) => setSimulateAttribution(e.target.checked)}
              className="h-3 w-3 accent-zinc-700"
            />
            animate
          </label>
        )}
        {availableLanguages.length > 1 && (
          <select
            // "auto" (unpinned) compiles a multilingual prompt — every declared
            // language's scripts/FAQ — so the caller can switch languages
            // mid-conversation and the model has the reviewed translation for
            // each. A pinned language compiles a single-language prompt. Same
            // meaning in every mode.
            value={language ?? ""}
            onChange={(e) => setLanguage(e.target.value || undefined)}
            disabled={hasSession}
            title="auto: multilingual prompt — the caller can switch languages mid-conversation. Pin a language to scope to one. Locked once a session is running."
            className="ml-auto rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <option value="">auto</option>
            {availableLanguages.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        )}
      </div>

      {hasSession && isPromptMode(mode) && specChanged && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          Spec changed since session start. Reset to re-render the system prompt.
        </div>
      )}

      {/* Persona owns the world: prompt + vars + per-cap mocks. Load
          picks the next run's persona; vars/mocks editors are inline. */}
      {spec && (
        <PersonaForm
          spec={spec}
          disabled={false}
          hideRunControls={!!activeCase || !!activeGold}
        />
      )}

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
          // The synthetic [begin] trigger isn't a real user turn — keep it out
          // of the rendered transcript (it stays in the array for the agent's
          // dispatch). Return null to preserve index math for the rest.
          if (t.text === PROMPT_MODE_BEGIN) return null;
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
          // During a gold run, attach the gold's agent turn at this index
          // beneath the live agent bubble. undefined = the agent produced
          // more turns than the gold has (drift past the gold's end).
          const goldRef =
            activeGold && agentIndex !== null
              ? {
                  text: goldAgentTurns[agentIndex - 1],
                  verdict: goldTurnVerdicts?.[agentIndex - 1] ?? null,
                }
              : null;
          return (
            <div key={i} className="space-y-1">
              <TurnView
                turn={t}
                index={i}
                spec={spec}
                displayText={showTranslated ? translations.get(t.ts) : undefined}
                onFork={mode === "text" ? onForkTurn : undefined}
              />
              {goldRef && (
                <GoldTurnRef
                  goldText={goldRef.text}
                  displayText={showTranslated ? goldTranslations.get((agentIndex ?? 0) - 1) : undefined}
                  verdict={goldRef.verdict}
                />
              )}
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
        {activeGold && hasSession && transcript.length > 0 && !isRunning && (
          <GoldTailNote
            goldAgentCount={goldAgentTurns.length}
            liveAgentCount={transcript.filter((t) => t.role === "agent").length}
          />
        )}
        {evaluating && !guardrailVerdict && (
          <div className="text-xs text-zinc-500 italic">evaluating guardrails…</div>
        )}
        {guardrailVerdict && <GuardrailEvalCard verdict={guardrailVerdict} />}
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
              title="End this session and start fresh against the same spec."
              className="shrink-0 rounded border border-red-300 bg-white px-2 py-0.5 text-red-700 hover:bg-red-100"
            >
              Clear
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

      {hasSession && !ended && mode === "voice" && (
        <VoiceFooter
          phase={voicePhase}
          status={status}
          micMuted={micMuted}
          onToggleMute={() => setMicMuted(!micMuted)}
          onEnd={onReset}
        />
      )}

      {hasSession && !ended && mode !== "voice" && (
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
            <div className="flex items-center gap-1.5">
              {transcript.length > 0 && (
                <button
                  onClick={() => void evaluate()}
                  disabled={evaluating || busy || isRunning}
                  title="Holistically judge the transcript so far for hallucinations and against the agent's guardrails."
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
                >
                  {evaluating ? "Evaluating…" : "Evaluate"}
                </button>
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
            {transcript.length > 0 && (
              <button
                onClick={() => void evaluate()}
                disabled={evaluating}
                title="Holistically judge the transcript for hallucinations and against the agent's guardrails."
                className="rounded border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
              >
                {evaluating ? "Evaluating…" : "Evaluate"}
              </button>
            )}
            <button
              onClick={onReset}
              className="rounded bg-zinc-900 px-2 py-1 text-white hover:bg-zinc-700"
            >
              Clear
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

function ActiveGoldStrip({
  gold,
  isRunning,
  hasSession,
  busy,
  onRun,
  onStop,
  onUnload,
}: {
  gold: Gold;
  isRunning: boolean;
  hasSession: boolean;
  busy: boolean;
  onRun: () => void;
  onStop: () => void;
  onUnload: () => void;
}) {
  const userTurns = gold.turns.filter((t) => t.role === "user").length;
  const agentTurns = gold.turns.filter((t) => t.role === "agent").length;
  return (
    <div className="border-b border-zinc-200 bg-sky-50/60 px-3 py-1.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-zinc-900">
            Running gold: {gold.name || gold.id}
          </div>
          <div className="truncate text-[10px] text-zinc-600">
            replay · {userTurns} user turn{userTurns === 1 ? "" : "s"} · compare vs{" "}
            {agentTurns} gold agent turn{agentTurns === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isRunning ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop gold run"
              className="rounded border border-red-300 bg-red-50 px-2 py-1 text-[12px] font-medium text-red-700 hover:bg-red-100"
              title="Stop. Any in-flight LLM call still completes; the loop halts on the next turn."
            >
              ■
            </button>
          ) : (
            <button
              type="button"
              onClick={onRun}
              disabled={busy || userTurns === 0}
              aria-label={hasSession ? "Re-run gold" : "Run gold"}
              className="rounded bg-zinc-900 px-2 py-1 text-[12px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
              title={
                hasSession
                  ? "Re-replay this gold's user turns against the current spec."
                  : "Replay this gold's user turns against the current spec."
              }
            >
              {hasSession ? "↻" : "▶"}
            </button>
          )}
          <button
            type="button"
            onClick={onUnload}
            disabled={isRunning}
            aria-label="Unload gold"
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-[12px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            title="Unload the active gold binding."
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline gold reference shown beneath a live agent bubble during a gold
// run. Pairs by agent-turn index. Exact text matches are rare for LLM
// output, so the "≈"/"≠" marker only flags whether the normalized text is
// identical, not whether the meaning diverged — it's a reading aid, not a
// verdict. undefined goldText = the agent ran past the gold's last turn.
function GoldTurnRef({
  goldText,
  displayText,
  verdict,
}: {
  goldText: string | undefined;
  displayText?: string;
  verdict: GoldTurnVerdict | "pending" | null;
}) {
  if (goldText === undefined) {
    return (
      <div className="ml-6 text-[10px] text-zinc-400">
        <span className="font-mono">·</span> past gold — no reference turn
      </div>
    );
  }

  let dot: React.ReactNode;
  let note: React.ReactNode = null;
  if (verdict === "pending") {
    dot = <span className="font-mono text-zinc-400">·</span>;
    note = <span className="italic text-zinc-400">judging…</span>;
  } else if (verdict?.equivalent) {
    dot = <span className="font-mono text-emerald-500">✓</span>;
    note = <span className="text-zinc-500">{verdict.note}</span>;
  } else if (verdict) {
    dot = <span className="font-mono text-red-500">✗</span>;
    note = <span className="text-red-400">{verdict.note}</span>;
  } else {
    dot = <span className="font-mono text-zinc-400">·</span>;
  }

  return (
    <div className="ml-6 text-[10px] leading-snug">
      {dot}{" "}
      <span className="whitespace-pre-wrap text-zinc-500">{displayText ?? goldText}</span>
      {note && <div className="mt-0.5 ml-3">{note}</div>}
    </div>
  );
}

// Trailing note for the inline gold view: the gold expected more agent
// turns than the live run produced (agent ended early). The over-run case
// is covered inline by GoldTurnRef's "past gold" markers, so this only
// handles the under-run tail that has no live bubble to attach to.
function GoldTailNote({
  goldAgentCount,
  liveAgentCount,
}: {
  goldAgentCount: number;
  liveAgentCount: number;
}) {
  const missing = goldAgentCount - liveAgentCount;
  if (missing <= 0) return null;
  return (
    <div className="ml-6 text-[10px] text-amber-600">
      gold expected {missing} more agent turn{missing === 1 ? "" : "s"} (agent ended early)
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

// Holistic evaluation verdict for the current transcript: hallucination
// grounding (always judged) plus the agent's guardrails.
// Results-only display — the trigger is the "Evaluate" button in the footer
// next to Send. Unlike RubricsCard this needs no active case (it judges
// against grounding and the agent's own stated invariants), so it renders on
// any session once a verdict exists. The "met" markers mirror the rubric card.
function GuardrailEvalCard({ verdict }: { verdict: GuardrailVerdict }) {
  const skipped = verdict.status === "skipped";
  const color = skipped
    ? "border-zinc-200 bg-white text-zinc-900"
    : verdict.verdict === "fail"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";
  const headIcon = skipped ? "○" : verdict.verdict === "fail" ? "✗" : "✓";
  const metIcon = (met: string) => (met === "no" ? "✗" : met === "yes" ? "✓" : "·");
  return (
    <div className={`rounded border ${color} p-2 text-[11px] space-y-1`}>
      <div className="font-medium">
        {headIcon} evaluation
        {!skipped && <span className="font-mono"> · {verdict.verdict}</span>}
        {!skipped && verdict.failure_mode !== "none" && (
          <span className="font-mono text-[10px] text-zinc-500">
            {" · "}
            {verdict.failure_mode}
          </span>
        )}
      </div>
      <div className="text-[10px] text-zinc-600">{verdict.summary}</div>
      {!skipped && (
        <>
          {verdict.hallucinations.map((h, i) => (
            <div key={`h-${i}`} className="text-[10px]">
              <span className="text-red-700">
                ✗ hallucination{h.turn >= 0 ? ` (turn ${h.turn})` : ""}: {h.claim}
              </span>
              {h.reason && <span className="text-zinc-500"> — {h.reason}</span>}
            </div>
          ))}
          {verdict.guardrails.map((g, i) => (
            <div key={`g-${i}`} className="text-[10px]">
              <span className={g.met === "no" ? "text-red-700" : "text-zinc-600"}>
                {metIcon(g.met)} {g.statement}
              </span>
              {g.reason && <span className="text-zinc-500"> — {g.reason}</span>}
            </div>
          ))}
        </>
      )}
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

// Voice-mode footer: a mic mute toggle plus a live phase indicator. There's
// no text input — the conversation is full-duplex over the Live socket — so
// the only controls are mute and end (mirrored in the header's "clear").
function VoiceFooter({
  phase,
  status,
  micMuted,
  onToggleMute,
  onEnd,
}: {
  phase: VoicePhase | null;
  status: SimulateStatus;
  micMuted: boolean;
  onToggleMute: () => void;
  onEnd: () => void;
}) {
  const connecting = status === "starting";
  const label = connecting
    ? "connecting…"
    : phase === "speaking"
      ? "agent speaking…"
      : phase === "listening"
        ? "listening…"
        : micMuted
          ? "muted"
          : "listening…";
  const dotColor = connecting
    ? "bg-zinc-300"
    : phase === "speaking"
      ? "bg-emerald-500"
      : micMuted
        ? "bg-zinc-300"
        : "bg-sky-500 animate-pulse";
  return (
    <div className="flex items-center justify-between gap-2 border-t border-zinc-200 p-2.5">
      <div className="flex items-center gap-2 text-[11px] text-zinc-600">
        <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
        {label}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleMute}
          disabled={connecting}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
            micMuted
              ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
              : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
          }`}
          title={micMuted ? "Unmute the mic" : "Mute the mic"}
        >
          {micMuted ? "🔇 Unmute" : "🎙 Mute"}
        </button>
        <button
          type="button"
          onClick={onEnd}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
          title="End the voice session."
        >
          End
        </button>
      </div>
    </div>
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
      {isPromptMode(mode) && !apiKey && (
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
        disabled={isPromptMode(mode) && !apiKey}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {mode === "voice" ? "Start voice session" : "Start session"}
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

  // The runner emits exit_path_taken after the agent's utterance, when routing
  // for the next turn is decided. Use the first one as the boundary: events
  // before it set up the utterance, events from it on describe routing.
  // Key on exit_path_taken only — it covers transition and terminal routing
  // both (to_flow_id is null for terminal). flow_exited also fires for
  // reason="interrupted"/"returned", which are mid-turn stack pops, not
  // next-turn routing; splitting on those would mis-group an interrupt turn.
  let splitIdx = events.findIndex((ev) => ev.type === "exit_path_taken");
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

