import { useEffect, useRef, useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import { useSettingsStore } from "@/lib/store/settings";
import { useSimulateStore, type TranscriptTurn } from "@/lib/store/simulate";
import { formatErrors, validateSpec } from "@/lib/validation/ajv";
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
  const sessionId = useSimulateStore((s) => s.sessionId);
  const status = useSimulateStore((s) => s.status);
  const transcript = useSimulateStore((s) => s.transcript);
  const events = useSimulateStore((s) => s.events);
  const variables = useSimulateStore((s) => s.variables);
  const contextVars = useSimulateStore((s) => s.contextVars);
  const currentFlowId = useSimulateStore((s) => s.currentFlowId);
  const error = useSimulateStore((s) => s.error);
  const start = useSimulateStore((s) => s.start);
  const send = useSimulateStore((s) => s.send);
  const reset = useSimulateStore((s) => s.reset);
  const hydrateContextVars = useSimulateStore((s) => s.hydrateContextVars);

  const [input, setInput] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const spec = useSpecStore((s) => s.spec);

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
    await start(runnerUrl, current, apiKey, model, current.agent.meta.languages?.[0]);
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
            {currentFlowId ? `${subtitle} · ${currentFlowId}` : subtitle}
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

      {spec && <VariablesForm spec={spec} disabled={busy || ready} />}

      <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3 text-sm">
        {!hasSession && status !== "starting" && (
          <EmptyState
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

function EmptyState({
  apiKey,
  specLoaded,
  validationErrors,
  onStart,
  onOpenSettings,
}: {
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
      <p>Talk to your spec using the XXX runtime.</p>
      <p>
        Paste an{" "}
        <button onClick={onOpenSettings} className="underline hover:text-zinc-900">
          API key in Settings
        </button>{" "}
        to use your own quota.
      </p>
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
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
      >
        Start session
        {!apiKey && <span className="ml-1 opacity-70">(runner credentials)</span>}
      </button>
    </div>
  );
}

function TurnView({ turn }: { turn: TranscriptTurn }) {
  const { role, text, events } = turn;
  return (
    <div className="space-y-1">
      {role === "user" ? (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white whitespace-pre-wrap">
            {text}
          </div>
        </div>
      ) : (
        text && (
          <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900 whitespace-pre-wrap">
            {text}
          </div>
        )
      )}
      {events.map((ev, i) => {
        const line = formatEvent(ev);
        if (!line) return null;
        return (
          <details
            key={i}
            className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-mono text-zinc-700"
          >
            <summary className="cursor-pointer list-none">
              <span className="text-zinc-500">→ </span>
              {line}
            </summary>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap text-[10px] text-zinc-500">
              {JSON.stringify(ev, null, 2)}
            </pre>
          </details>
        );
      })}
    </div>
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
