import { useEffect, useRef, useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import { useSettingsStore } from "@/lib/store/settings";
import { useSimulateStore, type TranscriptTurn } from "@/lib/store/simulate";
import { chat, DEFAULT_PROVIDER } from "@ux4/core/llm/dispatch";
import { findTool, toolDefinitions } from "@/lib/chat/tools";
import { systemPrompt } from "@ux4/core/llm/prompts";
import { formatErrors, validateSpec } from "@ux4/core/validation/ajv";
import type { ChatMessage } from "@ux4/core/llm/types";
import type { Spec } from "@ux4/core/schema/v0";
import type { RuntimeEvent } from "@ux4/core/runtime/eventTypes";
import { formatEvent } from "@ux4/core/runtime/formatEvent";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

const MAX_AGENT_LOOPS = 12;

export function ChatPanel({ open, onClose, onOpenSettings }: ChatPanelProps) {
  const apiKey = useSettingsStore((s) => s.googleApiKey);
  const model = useSettingsStore((s) => s.googleModel);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  if (!open) return null;

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    if (!apiKey) {
      setError("Add your Google API key in Settings first.");
      return;
    }
    setError(null);
    setInput("");

    const initialSpec = useSpecStore.getState().spec;
    const sim = useSimulateStore.getState();
    let history: ChatMessage[] = [
      ...messages,
      { role: "user", content: buildUserContent(text, initialSpec, sim) },
    ];
    setMessages(history);
    setBusy(true);

    try {
      for (let i = 0; i < MAX_AGENT_LOOPS; i++) {
        const res = await chat(DEFAULT_PROVIDER, apiKey, model, {
          systemPrompt,
          messages: history,
          tools: toolDefinitions,
        });
        history = [
          ...history,
          {
            role: "assistant",
            content: res.text,
            toolCalls: res.toolCalls.length > 0 ? res.toolCalls : undefined,
          },
        ];
        setMessages(history);

        if (res.toolCalls.length === 0) break;

        for (const call of res.toolCalls) {
          const tool = findTool(call.name);
          let result: string;
          if (!tool) {
            result = JSON.stringify({ ok: false, error: `unknown tool: ${call.name}` });
          } else {
            try {
              const out = await tool.impl(call.arguments);
              result = JSON.stringify(out);
            } catch (e) {
              result = JSON.stringify({
                ok: false,
                error: e instanceof Error ? e.message : "tool error",
              });
            }
          }
          history = [
            ...history,
            { role: "tool", toolCallId: call.id, result },
          ];
        }
        setMessages(history);

        const post = useSpecStore.getState().spec;
        if (post) {
          const v = validateSpec(post);
          if (!v.valid) {
            const errs = formatErrors(v.errors).slice(0, 20);
            history = [
              ...history,
              {
                role: "user",
                content: `Validation errors after your tool calls:\n${errs.join("\n")}\n\nFix the spec.`,
              },
            ];
            setMessages(history);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    setMessages([]);
    setError(null);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  return (
    <aside className="flex flex-col h-full w-[380px] border-l border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
        <div>
          <div className="text-sm font-semibold text-zinc-900">Chat</div>
          <div className="text-[11px] text-zinc-500">{model}</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearChat}
            disabled={messages.length === 0}
            className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
          >
            clear
          </button>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100"
          >
            close
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3 text-sm">
        {messages.length === 0 && !busy && (
          <EmptyHint hasKey={!!apiKey} onOpenSettings={onOpenSettings} />
        )}
        {messages.map((m, i) => (
          <MessageView key={i} m={m} />
        ))}
        {busy && (
          <div className="text-xs text-zinc-500 italic">thinking…</div>
        )}
      </div>

      {error && (
        <div className="border-t border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
          {error}
        </div>
      )}

      <div className="border-t border-zinc-200 p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={apiKey ? "Describe a change… (⌘↵ to send)" : "Add your API key in Settings to start."}
          disabled={busy || !apiKey}
          rows={3}
          className="w-full resize-none rounded border border-zinc-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 disabled:bg-zinc-50"
        />
        <div className="mt-1 flex justify-end">
          <button
            onClick={send}
            disabled={busy || !input.trim() || !apiKey}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  );
}

function EmptyHint({
  hasKey,
  onOpenSettings,
}: {
  hasKey: boolean;
  onOpenSettings: () => void;
}) {
  if (!hasKey) {
    return (
      <div className="text-xs text-zinc-500">
        Set up chat by adding a Google API key in{" "}
        <button
          onClick={onOpenSettings}
          className="underline hover:text-zinc-900"
        >
          Settings
        </button>
        .
      </div>
    );
  }
  return (
    <div className="text-xs text-zinc-500 space-y-2">
      <p>Ask me to create or edit the spec on the canvas. Try:</p>
      <ul className="list-disc pl-4 space-y-0.5">
        <li>&ldquo;Create a coffee-ordering agent with greet, order, and confirm flows.&rdquo;</li>
        <li>&ldquo;Paste a system prompt and I&rsquo;ll build the spec from it.&rdquo;</li>
        <li>&ldquo;Add a guardrail that we never ask for credit card numbers.&rdquo;</li>
        <li>&ldquo;Split flow_greet into greet + collect_name.&rdquo;</li>
      </ul>
    </div>
  );
}

function MessageView({ m }: { m: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white whitespace-pre-wrap">
          {stripSpec(m.content)}
        </div>
      </div>
    );
  }
  if (m.role === "assistant") {
    return (
      <div className="space-y-1">
        {m.content && (
          <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900 whitespace-pre-wrap">
            {m.content}
          </div>
        )}
        {m.toolCalls?.map((c) => (
          <div
            key={c.id}
            className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-mono text-zinc-700"
          >
            <span className="text-zinc-500">→ </span>
            <span className="font-semibold">{c.name}</span>
            <span className="text-zinc-500">
              ({summarizeArgs(c.arguments)})
            </span>
          </div>
        ))}
      </div>
    );
  }
  // tool result
  let parsed: { ok?: boolean; error?: string } = {};
  try {
    parsed = JSON.parse(m.result);
  } catch {
    // ignore
  }
  const failed = parsed.ok === false;
  return (
    <div
      className={`ml-3 rounded-md border px-2 py-1 text-[11px] font-mono ${
        failed
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-zinc-200 bg-white text-zinc-500"
      }`}
    >
      {failed ? `error: ${parsed.error ?? "unknown"}` : "ok"}
    </div>
  );
}

interface SimContext {
  sessionId: string | null;
  mode: "prompt" | "runner";
  status: string;
  currentFlowId: string | null;
  variables: Record<string, unknown>;
  transcript: TranscriptTurn[];
  events: RuntimeEvent[];
}

function buildUserContent(
  userText: string,
  spec: Spec | null,
  sim: SimContext,
): string {
  const specBlock = spec
    ? `<spec>\n${JSON.stringify(spec, null, 2)}\n</spec>`
    : `<spec>(empty — no spec loaded yet)</spec>`;
  const simBlock = sim.sessionId ? `\n\n${renderSimBlock(sim)}` : "";
  return `${specBlock}${simBlock}\n\n${userText}`;
}

function stripSpec(content: string): string {
  // Hide injected context blocks from the user view so the bubble shows just their words.
  const markers = ["</simulation>", "</spec>"];
  let idx = -1;
  let markerLen = 0;
  for (const m of markers) {
    const i = content.lastIndexOf(m);
    if (i > idx) {
      idx = i;
      markerLen = m.length;
    }
  }
  if (idx === -1) return content;
  return content.slice(idx + markerLen).trim();
}

function renderSimBlock(sim: SimContext): string {
  const header = [
    `mode: ${sim.mode}`,
    `status: ${sim.status}`,
    sim.currentFlowId ? `current_flow_id: ${sim.currentFlowId}` : null,
    Object.keys(sim.variables).length > 0
      ? `variables: ${JSON.stringify(sim.variables)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
  const lines: string[] = [];
  for (const turn of sim.transcript) {
    if (turn.role === "user") {
      lines.push(`user: ${turn.text}`);
      for (const ev of turn.events) {
        const fmt = formatEvent(ev);
        if (fmt) lines.push(`  → ${fmt}`);
      }
    } else {
      const pre: string[] = [];
      const post: string[] = [];
      let crossed = false;
      for (const ev of turn.events) {
        const isRouting = ev.type === "exit_path_taken" || ev.type === "flow_exited";
        if (isRouting) crossed = true;
        const fmt = formatEvent(ev);
        if (!fmt) continue;
        (crossed ? post : pre).push(`  → ${fmt}`);
      }
      lines.push(...pre);
      if (turn.text) lines.push(`agent: ${turn.text}`);
      lines.push(...post);
    }
  }
  const body = lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
  return `<simulation>\n${header}${body}\n</simulation>`;
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const obj = args as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return "";
  return keys
    .map((k) => {
      const v = obj[k];
      if (typeof v === "string") return `${k}: "${truncate(v, 30)}"`;
      if (v === null || typeof v === "number" || typeof v === "boolean") return `${k}: ${v}`;
      return `${k}: …`;
    })
    .join(", ");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
