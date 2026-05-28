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
import { VariablesForm } from "./VariablesForm";
import { CapabilityMocksForm } from "./CapabilityMocksForm";
import { PersonaForm } from "./PersonaForm";

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
  const [language, setLanguage] = useState<string | undefined>(undefined);

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
    if (!input.trim() || busy || ended || !canSend) return;
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

      {spec && <VariablesForm spec={spec} disabled={busy || ready} />}
      {spec && mode === "runner" && (
        <CapabilityMocksForm spec={spec} disabled={busy || ready} />
      )}

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
        {transcript.map((t, i) => (
          <TurnView
            key={i}
            turn={t}
            index={i}
            spec={spec}
            displayText={showTranslated ? translations.get(t.ts) : undefined}
            onFork={mode === "prompt" ? onForkTurn : undefined}
          />
        ))}
        {busy && hasSession && (
          <div className="text-xs text-zinc-500 italic">thinking…</div>
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
              disabled={busy || !canSend || !input.trim()}
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
    </aside>
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
            {shown}
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
      {text && (
        <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900 whitespace-pre-wrap">
          {shown}
        </div>
      )}
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

