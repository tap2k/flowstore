import { useEffect, useRef, useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import { useSettingsStore } from "@/lib/store/settings";
import {
  useSimulateStore,
  type SimulateMode,
  type TranscriptTurn,
} from "@/lib/store/simulate";
import { formatErrors, validateSpec } from "@/lib/validation/ajv";
import { generateSystemPrompt } from "@/lib/codegen/promptGenerator";
import type { RuntimeEvent } from "@/lib/runtime/eventTypes";
import { VariablesForm } from "./VariablesForm";

interface SimulatePanelProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function SimulatePanel({ open, onClose, onOpenSettings }: SimulatePanelProps) {
  const apiKey = useSettingsStore((s) => s.googleApiKey);
  const model = useSettingsStore((s) => s.googleModel);
  const runnerUrl = useSettingsStore((s) => s.runnerUrl);
  const mode = useSimulateStore((s) => s.mode);
  const sessionId = useSimulateStore((s) => s.sessionId);
  const status = useSimulateStore((s) => s.status);
  const transcript = useSimulateStore((s) => s.transcript);
  const events = useSimulateStore((s) => s.events);
  const variables = useSimulateStore((s) => s.variables);
  const contextVars = useSimulateStore((s) => s.contextVars);
  const currentFlowId = useSimulateStore((s) => s.currentFlowId);
  const systemPrompt = useSimulateStore((s) => s.systemPrompt);
  const specSnapshot = useSimulateStore((s) => s.specSnapshot);
  const lastUsage = useSimulateStore((s) => s.lastUsage);
  const error = useSimulateStore((s) => s.error);
  const setMode = useSimulateStore((s) => s.setMode);
  const start = useSimulateStore((s) => s.start);
  const send = useSimulateStore((s) => s.send);
  const reset = useSimulateStore((s) => s.reset);
  const hydrateContextVars = useSimulateStore((s) => s.hydrateContextVars);

  const [input, setInput] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const spec = useSpecStore((s) => s.spec);
  const availableLanguages = spec?.agent.meta.languages ?? [];
  const [language, setLanguage] = useState<string | undefined>(undefined);
  const prevAgentIdRef = useRef<string | undefined>(spec?.agent.id);

  useEffect(() => {
    // Default is "all" (undefined) — emit every language bucket. Reset to
    // "all" when the active agent changes, or when the current selection is
    // no longer in the new agent's language list.
    const agentId = spec?.agent.id;
    const langs = spec?.agent.meta.languages ?? [];
    if (prevAgentIdRef.current !== agentId) {
      prevAgentIdRef.current = agentId;
      setLanguage(undefined);
      return;
    }
    if (language !== undefined && !langs.includes(language)) {
      setLanguage(undefined);
    }
  }, [spec?.agent.id, spec?.agent.meta.languages, language]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript, status]);

  useEffect(() => {
    if (open && spec) hydrateContextVars(spec.agent.id);
  }, [open, spec, hydrateContextVars]);

  if (!open) return null;

  const agentName = spec?.agent.meta.name ?? "—";
  const busy = status === "thinking" || status === "starting";
  const ended = status === "ended";
  const ready = status === "ready";

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
      model,
      baseUrl: mode === "runner" ? runnerUrl : undefined,
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
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const agentId = current?.agent.id ?? "unknown";
    const shortId = sessionId ? sessionId.slice(0, 8) : "nosess";
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const a = document.createElement("a");
    a.href = url;
    a.download = `uxflows-trace-${agentId}-${shortId}-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onSend() {
    if (!input.trim() || busy || ended || !ready) return;
    const text = input;
    setInput("");
    await send(text);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    }
  }

  const hasSession = sessionId !== null;
  const specChanged = specSnapshot !== null && spec !== null && spec !== specSnapshot;
  const previewPrompt =
    mode === "prompt"
      ? (systemPrompt ?? (spec ? generateSystemPrompt(spec, contextVars, { language }) : null))
      : null;
  const subtitle = (() => {
    if (status === "starting") return "starting…";
    if (status === "thinking") return "thinking…";
    if (status === "ended") return "ended";
    if (status === "error") return error ?? "error";
    if (status === "ready") return "ready";
    return "idle";
  })();

  return (
    <aside className="flex flex-col h-full w-[380px] border-l border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900 truncate">
            Simulate
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
        <div className="flex overflow-hidden rounded border border-zinc-200">
          <ModeButton current={mode} value="prompt" disabled={hasSession} onClick={setMode}>
            Prompt
          </ModeButton>
          {runnerUrl && (
            <ModeButton current={mode} value="runner" disabled={hasSession} onClick={setMode}>
              Runner
            </ModeButton>
          )}
        </div>
        {mode === "prompt" && (
          <span className="truncate text-zinc-500">{model}</span>
        )}
        {mode === "runner" && (
          <span className="truncate text-zinc-500">{runnerUrl}</span>
        )}
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

      {hasSession && mode === "prompt" && specChanged && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          Spec changed since session start. Reset to re-render the system prompt.
        </div>
      )}

      {previewPrompt && (
        <div className="border-b border-zinc-200 bg-zinc-50/50">
          <div className="flex items-center justify-between gap-2 px-4 py-2 text-[11px] text-zinc-600">
            <button
              type="button"
              onClick={() => setPromptOpen((o) => !o)}
              className="flex flex-1 items-center text-left hover:text-zinc-900"
            >
              <span className="mr-1 text-zinc-400">{promptOpen ? "▾" : "▸"}</span>
              System prompt
              <span className="ml-1 text-zinc-400">
                ({previewPrompt.length.toLocaleString()} chars)
              </span>
            </button>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(previewPrompt)}
              className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
              title="Copy the rendered system prompt to clipboard."
            >
              Copy
            </button>
          </div>
          {promptOpen && (
            <div className="px-4 pb-3">
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-zinc-200 bg-white p-2 font-mono text-[10px] leading-snug text-zinc-700">
                {previewPrompt}
              </pre>
            </div>
          )}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3 text-sm">
        {!hasSession && status !== "starting" && (
          <EmptyState
            mode={mode}
            apiKey={apiKey}
            specLoaded={!!spec}
            validationErrors={validationErrors}
            onStart={startSession}
            onOpenSettings={onOpenSettings}
          />
        )}
        {transcript.map((t, i) => (
          <TurnView key={i} turn={t} />
        ))}
        {busy && hasSession && (
          <div className="text-xs text-zinc-500 italic">thinking…</div>
        )}
      </div>

      {error && status === "error" && (
        <div className="border-t border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
          {error}
        </div>
      )}

      {hasSession && !ended && (
        <div className="border-t border-zinc-200 p-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type as the user… (⌘↵ to send)"
            disabled={busy || !ready}
            rows={3}
            className="w-full resize-none rounded border border-zinc-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 disabled:bg-zinc-50"
          />
          <div className="mt-1 flex justify-end">
            <button
              onClick={onSend}
              disabled={busy || !ready || !input.trim()}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {ended && (
        <div className="border-t border-zinc-200 px-3 py-2 flex items-center justify-between text-[11px] text-zinc-600">
          <span>Session ended.</span>
          <button
            onClick={onReset}
            className="rounded bg-zinc-900 px-2 py-1 text-white hover:bg-zinc-700"
          >
            Reset
          </button>
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
  specLoaded,
  validationErrors,
  onStart,
  onOpenSettings,
}: {
  mode: SimulateMode;
  apiKey: string;
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
            Requires a Google API key in Settings.
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

function TurnView({ turn }: { turn: TranscriptTurn }) {
  const { role, text, events } = turn;

  if (role === "user") {
    return (
      <div className="space-y-1">
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white whitespace-pre-wrap">
            {text}
          </div>
        </div>
        {events.map((ev, i) => (
          <EventLine key={i} ev={ev} />
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
        <EventLine key={`pre-${i}`} ev={ev} />
      ))}
      {text && (
        <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900 whitespace-pre-wrap">
          {text}
        </div>
      )}
      {postEvents.map((ev, i) => (
        <EventLine key={`post-${i}`} ev={ev} />
      ))}
    </div>
  );
}

function EventLine({ ev }: { ev: RuntimeEvent }) {
  const line = formatEvent(ev);
  if (!line) return null;
  return (
    <details className="px-1 text-[10px] font-mono text-zinc-400 hover:text-zinc-600">
      <summary className="cursor-pointer list-none">
        <span className="text-zinc-300">→ </span>
        {line}
      </summary>
      <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-[10px] text-zinc-500">
        {JSON.stringify(ev, null, 2)}
      </pre>
    </details>
  );
}

function formatEvent(ev: RuntimeEvent): string | null {
  switch (ev.type) {
    case "session_started":
      return `session_started(${ev.lang})`;
    case "session_ended":
      return `session_ended(${ev.reason})`;
    case "flow_entered":
      return `flow_entered(${ev.flow_id}${ev.via !== "transition" ? `, via=${ev.via}` : ""})`;
    case "flow_exited":
      return null; // redundant with exit_path_taken
    case "exit_path_taken":
      return `exit_path_taken(${ev.from_flow_id} → ${ev.to_flow_id ?? "∅"}, ${ev.method})`;
    case "interrupt_triggered":
      return `interrupt_triggered(${ev.from_flow_id} → ${ev.interrupt_flow_id})`;
    case "turn_started":
    case "turn_completed":
      return null; // implied by transcript bubbles
    case "variable_set":
      return `variable_set(${ev.variable_name} = ${formatValue(ev.value)}, ${ev.method})`;
    case "capability_invoked":
      return `capability_invoked(${ev.capability_name})`;
    case "capability_returned":
      return ev.error
        ? `capability_returned(${ev.capability_name}, error=${ev.error})`
        : `capability_returned(${ev.capability_name})`;
    case "error":
      return `error(${ev.code}: ${ev.message})`;
  }
}

function formatValue(v: unknown): string {
  if (typeof v === "string") {
    const s = v.length > 30 ? `${v.slice(0, 30)}…` : v;
    return `"${s}"`;
  }
  if (v === null || typeof v === "number" || typeof v === "boolean") return String(v);
  return "…";
}
