import { useEffect, useRef, useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import { loadSpec } from "@/lib/store/loadSpec";
import { resolveDispatch, useSettingsStore } from "@/lib/store/settings";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import { useSimulateStore, type TranscriptTurn } from "@/lib/store/simulate";
import { useTestsStore } from "@/lib/store/tests";
import { evaluateCaseAgainstTranscript, type CaseVerdicts } from "@/lib/caseVerdicts";
import type { GuardrailVerdict } from "@flowstore/core/runtime/judgeGuardrails";
import type { Rubric } from "@flowstore/core/schema/files/rubric";
import { chat } from "@flowstore/core/llm/dispatch";
import { ModelPicker } from "@/components/runtime/ModelPicker";
import { findTool, toolDefinitions } from "@/lib/chat/tools";
import { parseSourceToSpec, type SourceFile } from "@/lib/chat/specParse";
import { systemPrompt } from "@flowstore/core/llm/prompts";
import { formatErrors, validateSpec } from "@flowstore/core/validation/ajv";
import type { ChatMessage } from "@flowstore/core/llm/types";
import type { Spec } from "@flowstore/core/schema/v0";
import type { RuntimeEvent } from "@flowstore/core/runtime/eventTypes";
import { formatEvent } from "@flowstore/core/runtime/formatEvent";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

const MAX_AGENT_LOOPS = 12;

export function ChatPanel({ open, onClose, onOpenSettings }: ChatPanelProps) {
  const model = useSettingsStore((s) => s.chatModel);
  const setChatModel = useSettingsStore((s) => s.setChatModel);
  // Recompute on every render so the dispatch params (key, baseUrl, provider)
  // stay in sync with both the picker and any setting changes the user
  // makes in another tab/Settings sheet.
  const dispatch = resolveDispatch(model);
  const apiKey = dispatch.apiKey;
  const provider = dispatch.provider;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<SourceFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, parsing]);

  if (!open) return null;

  const working = busy || parsing;

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const read = await Promise.all(
      Array.from(list).map(async (f) => ({ name: f.name, content: await f.text() })),
    );
    // De-dupe by name (re-dropping a file replaces the older copy).
    setAttachments((prev) => {
      const byName = new Map(prev.map((a) => [a.name, a]));
      for (const r of read) byName.set(r.name, r);
      return Array.from(byName.values());
    });
  }

  function removeAttachment(name: string) {
    setAttachments((prev) => prev.filter((a) => a.name !== name));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (working) return;
    void addFiles(e.dataTransfer.files);
  }

  // The AGENT-SPEC-PROMPT wrapper: build a fresh spec from the attached source
  // material in one shot, in-editor (vs. round-tripping through an external LLM).
  async function buildFromSource() {
    if (working) return;
    if (attachments.length === 0) {
      setError("Attach source files first — build-from-source reads them to author the spec.");
      return;
    }
    if (!provider) {
      setError(`No provider configured for "${model}". Add an explicit endpoint in models config.`);
      return;
    }
    if (!apiKey) {
      setError(`Add a ${providerLabel(dispatch.endpoint)} API key in Settings first.`);
      return;
    }
    if (useSpecStore.getState().spec && !window.confirm("Replace the current spec with one built from these sources?")) {
      return;
    }
    setError(null);

    const names = attachments.map((a) => a.name);
    const count = attachments.length;
    setMessages((m) => [
      ...m,
      { role: "user", content: `Build a spec from source: ${names.join(", ")}` },
    ]);
    setParsing(true);
    try {
      const res = await parseSourceToSpec(
        provider,
        apiKey,
        dispatch.wireModel,
        attachments,
        input.trim(),
        { baseUrl: dispatch.baseUrl },
      );
      if (!res.ok) {
        setError(res.errors?.length ? `${res.error}\n${res.errors.join("\n")}` : res.error);
        return;
      }
      // Brand-new spec built from source — a bare load, so clear any prior
      // tests/comments/sim session rather than orphaning them onto it.
      loadSpec(res.spec);
      setAttachments([]);
      setInput("");
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Built a spec from ${count} source file${count === 1 ? "" : "s"}. Review it on the canvas, then ask me to refine it.`,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Build from source failed.");
    } finally {
      setParsing(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || working) return;
    if (!provider) {
      setError(`No provider configured for "${model}". Add an explicit endpoint in models config.`);
      return;
    }
    if (!apiKey) {
      setError(`Add a ${providerLabel(dispatch.endpoint)} API key in Settings first.`);
      return;
    }
    setError(null);
    setInput("");

    const attached = attachments;
    setAttachments([]);
    const initialSpec = useSpecStore.getState().spec;
    const sim = useSimulateStore.getState();
    const evaluation = collectEvaluation(sim);
    let history: ChatMessage[] = [
      ...messages,
      { role: "user", content: buildUserContent(text, initialSpec, sim, attached, evaluation) },
    ];
    setMessages(history);
    setBusy(true);

    try {
      for (let i = 0; i < MAX_AGENT_LOOPS; i++) {
        const res = await chat(
          provider,
          apiKey,
          dispatch.wireModel,
          {
            systemPrompt,
            messages: history,
            tools: toolDefinitions,
          },
          { baseUrl: dispatch.baseUrl },
        );
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
    setAttachments([]);
    setError(null);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  return (
    <aside
      className={`relative flex flex-col h-full w-[380px] border-l bg-white ${
        dragOver ? "border-zinc-700" : "border-zinc-200"
      }`}
      onDragOver={(e) => { e.preventDefault(); if (!working) setDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-zinc-50/90 border-2 border-dashed border-zinc-400 text-xs font-medium text-zinc-600">
          Drop files to attach
        </div>
      )}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
        <div>
          <div className="text-sm font-semibold text-zinc-900">Assistant</div>
          <ModelPicker
            value={model}
            onChange={setChatModel}
            className="text-[11px] text-zinc-500 bg-transparent border-none p-0 -ml-0.5 focus:outline-none focus:ring-0 cursor-pointer hover:text-zinc-900"
          />
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
          <EmptyHint hasKey={!!apiKey} endpoint={dispatch.endpoint} onOpenSettings={onOpenSettings} />
        )}
        {messages.map((m, i) => (
          <MessageView key={i} m={m} />
        ))}
        {busy && (
          <div className="text-xs text-zinc-500 italic">thinking…</div>
        )}
        {parsing && (
          <div className="text-xs text-zinc-500 italic">building spec from source…</div>
        )}
      </div>

      {error && (
        <div className="border-t border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
          {error}
        </div>
      )}

      <div className="border-t border-zinc-200 p-2">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {attachments.map((a) => (
              <span
                key={a.name}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700"
                title={a.name}
              >
                <PaperclipIcon />
                <span className="truncate max-w-[180px]">{a.name}</span>
                <button
                  onClick={() => removeAttachment(a.name)}
                  disabled={working}
                  className="text-zinc-400 hover:text-zinc-700 disabled:opacity-40"
                  aria-label={`Remove ${a.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={apiKey ? "Describe a change… (⌘↵ to send)" : "Add your API key in Settings to start."}
          disabled={working || !apiKey}
          rows={3}
          className="w-full resize-none rounded border border-zinc-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 disabled:bg-zinc-50"
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.markdown,.json,.yaml,.yml,.csv,.tsv,.text,text/*"
          onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
          className="hidden"
        />
        <div className="mt-1 flex items-center justify-between">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={working || !apiKey}
            title="Attach source files"
            aria-label="Attach files"
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40"
          >
            <PaperclipIcon />
            Attach
          </button>
          <div className="flex items-center gap-1.5">
            {attachments.length > 0 && (
              <button
                onClick={buildFromSource}
                disabled={working || !apiKey}
                title="Build a fresh spec from the attached source material"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
              >
                Build from source
              </button>
            )}
            <button
              onClick={send}
              disabled={working || !input.trim() || !apiKey}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function PaperclipIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function providerLabel(endpoint: ReturnType<typeof resolveDispatch>["endpoint"]): string {
  switch (endpoint) {
    case "google": return "Google";
    case "openai": return "OpenAI";
    case "openrouter": return "OpenRouter";
    case "openai-compatible": return "OpenAI-compatible";
    default: return "provider";
  }
}

function EmptyHint({
  hasKey,
  endpoint,
  onOpenSettings,
}: {
  hasKey: boolean;
  endpoint: ReturnType<typeof resolveDispatch>["endpoint"];
  onOpenSettings: () => void;
}) {
  if (!hasKey) {
    return (
      <div className="text-xs text-zinc-500">
        Set up Assistant by adding a {providerLabel(endpoint)} API key in{" "}
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
      <p>
        Or <strong>attach</strong> source files (a script, process doc, FAQ) and
        either reference them in chat, or click <strong>Build from source</strong>{" "}
        to generate a whole spec from them.
      </p>
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

interface RubricScore {
  name: string;
  score: number | null;
  max: number;
  notes: string;
}

interface EvaluationContext {
  guardrail: GuardrailVerdict | null;
  caseName: string | null;
  caseVerdicts: CaseVerdicts | null;
  rubricScores: RubricScore[];
}

// Snapshot the current evaluation state so the assistant can act on it ("fix
// the failing guardrail", "why did this assertion fail"). Rubrics are
// test-specific, so we only surface the ones actually judged for the active
// run — sim.rubricVerdicts is already scoped to the active case's bound
// evaluators — and resolve each name individually rather than pulling the
// whole rubric library into context.
function collectEvaluation(
  sim: ReturnType<typeof useSimulateStore.getState>,
): EvaluationContext {
  const tests = useTestsStore.getState();
  const activeCase = sim.activeCaseId
    ? tests.cases.find((c) => c.id === sim.activeCaseId) ?? null
    : null;
  const runComplete =
    sim.status !== "thinking" && sim.status !== "starting" && sim.transcript.length > 0;
  const caseVerdicts = activeCase
    ? evaluateCaseAgainstTranscript(activeCase, sim.transcript, runComplete)
    : null;
  const rubricScores: RubricScore[] = [];
  for (const [id, v] of Object.entries(sim.rubricVerdicts)) {
    if (v === "pending") continue;
    const r: Rubric | undefined = tests.rubrics.find((rr) => rr.id === id);
    rubricScores.push({
      name: r?.name || id,
      score: v.score,
      max: r?.scale?.max ?? 5,
      notes: v.notes,
    });
  }
  return {
    guardrail: sim.guardrailVerdict,
    caseName: activeCase?.name ?? activeCase?.id ?? null,
    caseVerdicts,
    rubricScores,
  };
}

function buildUserContent(
  userText: string,
  spec: Spec | null,
  sim: SimContext,
  attachments: SourceFile[],
  evaluation: EvaluationContext,
): string {
  const specBlock = spec
    ? `<spec>\n${JSON.stringify(spec, null, 2)}\n</spec>`
    : `<spec>(empty — no spec loaded yet)</spec>`;
  const gitBlock = `\n\n${renderGitBlock()}`;
  const simBlock = sim.sessionId ? `\n\n${renderSimBlock(sim)}` : "";
  const evalBlock = sim.sessionId ? renderEvaluationBlock(evaluation) : "";
  const filesBlock =
    attachments.length > 0
      ? `\n\n<files>\n${attachments
          .map((f) => `<file name=${JSON.stringify(f.name)}>\n${f.content}\n</file>`)
          .join("\n\n")}\n</files>`
      : "";
  // A short, human-readable attachment line survives stripSpec so the sent
  // bubble shows what was attached; the <files> block above is for the model.
  const note =
    attachments.length > 0 ? `📎 ${attachments.map((f) => f.name).join(", ")}\n\n` : "";
  return `${specBlock}${gitBlock}${simBlock}${evalBlock}${filesBlock}\n\n${note}${userText}`;
}

// One-line git situational awareness, built purely from local project state —
// no network call. It tells the model that git context exists and is
// inspectable; the actual history/diffs are pulled on demand via the
// git_* tools, keeping the per-turn context flat.
function renderGitBlock(): string {
  const gp = useGithubProjectStore.getState();
  if (!gp.location) {
    return "<git>local only — not connected to a GitHub repo; git_* tools unavailable</git>";
  }
  const sha = gp.lastKnownCommitSha ? gp.lastKnownCommitSha.slice(0, 7) : "uncommitted";
  const ro = gp.canWrite ? "" : " · read-only";
  return (
    `<git>repo: ${gp.location.owner}/${gp.location.repo} · branch: ${gp.location.ref} · saved @ ${sha}${ro}\n` +
    `Use git_diff_unsaved / git_diff_refs / git_log / git_list_branches to inspect diffs and history.</git>`
  );
}

// Compact rendering of the evaluation snapshot for the model. Each subsection
// is omitted when empty, so an unevaluated session contributes nothing.
function renderEvaluationBlock(e: EvaluationContext): string {
  const lines: string[] = [];
  const g = e.guardrail;
  if (g && g.status === "ok") {
    lines.push(
      `guardrails: ${g.verdict.toUpperCase()}${g.failure_mode !== "none" ? ` (${g.failure_mode})` : ""} — ${g.summary}`,
    );
    for (const gr of g.guardrails) {
      const mark = gr.met === "no" ? "✗" : gr.met === "yes" ? "✓" : "·";
      lines.push(`  ${mark} ${gr.statement}${gr.reason ? ` — ${gr.reason}` : ""}`);
    }
    if (g.business_goals.length > 0) {
      lines.push("business goals:");
      for (const bg of g.business_goals) {
        const mark =
          bg.met === "no" ? "✗" : bg.met === "yes" ? "✓" : bg.met === "partially" ? "◐" : "·";
        lines.push(`  ${mark} ${bg.id}${bg.reason ? ` — ${bg.reason}` : ""}`);
      }
    }
  }
  const cv = e.caseVerdicts;
  if (cv && cv.evaluable > 0) {
    lines.push(
      `assertions${e.caseName ? ` (case "${e.caseName}")` : ""}: ${cv.passed}/${cv.evaluable} passed`,
    );
    for (const v of [...cv.perTurn, ...cv.transcript]) {
      if (v.verdict === "fail") lines.push(`  ✗ ${v.reason ?? "failed"}`);
    }
  }
  if (e.rubricScores.length > 0) {
    lines.push("rubrics:");
    for (const r of e.rubricScores) {
      lines.push(
        `  ${r.name}: ${r.score === null ? "n/a" : `${r.score}/${r.max}`}${r.notes ? ` — ${r.notes}` : ""}`,
      );
    }
  }
  if (lines.length === 0) return "";
  return `\n\n<evaluation>\n${lines.join("\n")}\n</evaluation>`;
}

function stripSpec(content: string): string {
  // Hide injected context blocks from the user view so the bubble shows just their words.
  const markers = ["</files>", "</evaluation>", "</simulation>", "</git>", "</spec>"];
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
