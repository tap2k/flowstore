import { useMemo, useRef, useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import { useUiStore } from "@/lib/store/ui";
import {
  compileSystemPrompt,
  type PromptSource,
} from "@flowstore/core/codegen/promptGenerator";
import { defaultLanguage } from "@flowstore/core/schema/v0";
import { styleForSource, isClickable, labelFor, type PromptKind } from "@/lib/promptColors";

interface SystemPromptPanelProps {
  open: boolean;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────
// DELIBERATE DIVERGENCE FROM THE RAW COMPILED PROMPT.
//
// The panel's View mode does NOT show the literal compiled prompt. It strips
// the section headers and per-flow/per-interrupt numbering that merely restate
// the block's own colored label, so each block reads as just its content. This
// is a *display transform only*:
//   • The Copy button and every prompt consumer (Simulate, export, runner) use
//     the literal text from compileSystemPrompt — they are unaffected.
//   • A manual select-all + copy inside the panel WILL pick up this trimmed
//     text, not the literal prompt. Accepted tradeoff (low likelihood).
//
// The matched strings below mirror the headers emitted by promptGenerator.ts
// (renderGuardrails / flowsGroup / interruptsGroup). If those headers change,
// update them here too — there is no shared constant, this coupling is by hand.
//
// Knowledge is intentionally left verbatim: its "FAQ:" / "GLOSSARY:" lines are
// meaningful sub-structure, not a header that duplicates the "Knowledge" label.
// ─────────────────────────────────────────────────────────────────────────
function bodyForDisplay(kind: PromptKind, text: string): string {
  const lines = text.split("\n");
  const dropWhile = (pred: (line: string) => boolean) => {
    while (lines.length && pred(lines[0])) lines.shift();
    while (lines.length && lines[0] === "") lines.shift();
  };
  // flow/interrupt content is indented ≥3 spaces under the (removed) header.
  const dedent = () => lines.map((l) => (l.startsWith("   ") ? l.slice(3) : l)).join("\n");

  switch (kind) {
    case "flow":
      dropWhile((l) => l === "FLOW OF CALL:" || l.startsWith("Begin with: "));
      if (lines.length && /^\d+\. /.test(lines[0])) lines.shift(); // "N. Name" header
      return dedent();
    case "interrupt":
      dropWhile((l) => l === "INTERRUPTS (fire at any point):");
      if (lines.length && /^\d+\. /.test(lines[0])) lines.shift(); // "N. Name" header
      return dedent();
    case "guardrails":
      // Drop the header only; the numbered "1. …" lines are the guardrails.
      dropWhile((l) => l === "GUARDRAILS (apply at all times):");
      return lines.join("\n");
    default:
      return text; // role, knowledge, runtimeContext — shown verbatim
  }
}

function clickHint(kind: PromptKind): string {
  switch (kind) {
    case "flow":
    case "interrupt":
      return "Show on the canvas";
    case "role":
    case "templateWrapper":
      return "Open agent settings";
    case "guardrails":
      return "Open guardrails";
    case "knowledge":
      return "Open knowledge";
    default:
      return "";
  }
}

export function SystemPromptPanel({ open, onClose }: SystemPromptPanelProps) {
  const spec = useSpecStore((s) => s.spec);
  const requestFocus = useSpecStore((s) => s.requestFocus);
  const setSelection = useSpecStore((s) => s.setSelection);
  const promptOverride = useUiStore((s) => s.promptOverride);
  const setPromptOverride = useUiStore((s) => s.setPromptOverride);
  const promptOverrideSpecRef = useUiStore((s) => s.promptOverrideSpecRef);
  const setOpenSheet = useUiStore((s) => s.setOpenSheet);

  const [mode, setMode] = useState<"view" | "edit">("view");

  const availableLanguages = spec?.agent.meta.languages ?? [];
  const defaultLang = availableLanguages.length ? defaultLanguage(availableLanguages) : undefined;
  const [language, setLanguage] = useState<string | undefined>(defaultLang);

  // Reset the language to the agent default when the agent changes, or when the
  // current pick is no longer one of its languages. Done during render (matches
  // SimulatePanel) to avoid a wasted commit.
  const prevAgentIdRef = useRef(spec?.agent.id);
  if (prevAgentIdRef.current !== spec?.agent.id) {
    prevAgentIdRef.current = spec?.agent.id;
    if (language !== defaultLang) setLanguage(defaultLang);
  } else if (language && !availableLanguages.includes(language)) {
    setLanguage(defaultLang);
  }

  // View shows the un-substituted template — the panel inspects the spec, not a
  // session, so there are no variable values to substitute.
  const compiled = useMemo(
    () => (spec ? compileSystemPrompt(spec, undefined, { language }) : null),
    [spec, language],
  );

  if (!open || !spec || !compiled) return null;

  const compiledText = compiled.text;
  const editorValue = promptOverride ?? compiledText;
  const edited = promptOverride !== null && promptOverride !== compiledText;
  const specChangedSinceEdit =
    promptOverride !== null && promptOverrideSpecRef !== null && promptOverrideSpecRef !== spec;
  const charsDiff = Math.abs(editorValue.length - compiledText.length);

  function revert() {
    setPromptOverride(null);
    setMode("view");
  }

  function copy() {
    // Copy yields the LITERAL prompt (compiledText / the edit buffer), never the
    // display-trimmed text — what you paste must match what the LLM receives.
    // See bodyForDisplay for the deliberate View-mode divergence.
    void navigator.clipboard.writeText(mode === "edit" ? editorValue : compiledText);
  }

  function onSegmentClick(source: PromptSource) {
    switch (source.kind) {
      case "flow":
      case "interrupt":
        requestFocus("flow", source.flowId);
        setSelection({ kind: "flow", id: source.flowId });
        break;
      case "role":
      case "templateWrapper":
        setOpenSheet("agent");
        break;
      case "guardrails":
        setOpenSheet("guardrails");
        break;
      case "knowledge":
        setOpenSheet("knowledge");
        break;
      // runtimeContext has no editable source — not clickable.
    }
  }

  return (
    <aside className="flex flex-col h-full w-[380px] border-l border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
        <div className="text-sm font-semibold text-zinc-900">System prompt</div>
        <button
          onClick={onClose}
          className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100"
        >
          close
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-1.5 text-[11px]">
        <div className="flex overflow-hidden rounded border border-zinc-200">
          <ToggleButton active={mode === "view"} onClick={() => setMode("view")}>
            View
          </ToggleButton>
          <ToggleButton active={mode === "edit"} onClick={() => setMode("edit")} dot={edited}>
            Edit raw
          </ToggleButton>
        </div>
        <button
          onClick={copy}
          title="Copy the prompt to the clipboard as plain text."
          className="rounded px-2 py-0.5 text-zinc-600 hover:bg-zinc-100"
        >
          Copy
        </button>
        {availableLanguages.length > 1 && (
          <select
            value={language ?? ""}
            onChange={(e) => setLanguage(e.target.value || undefined)}
            disabled={mode === "edit"}
            title={
              mode === "edit"
                ? "Revert to change language"
                : "Render scripts and FAQ in this language."
            }
            className="ml-auto rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {availableLanguages.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        )}
      </div>

      {(specChangedSinceEdit || edited) && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <span>
            {specChangedSinceEdit
              ? "Spec changed since edit"
              : `Edited · ${charsDiff.toLocaleString()} chars different`}
          </span>
          <button
            onClick={revert}
            className="rounded border border-amber-300 bg-white px-2 py-0.5 text-amber-800 hover:bg-amber-100"
          >
            {specChangedSinceEdit ? "Revert to recompile" : "Revert"}
          </button>
        </div>
      )}

      {mode === "view" ? (
        <div className="flex-1 space-y-2 overflow-auto p-3">
          {compiled.segments.map((seg, i) => {
            const text = compiledText.slice(seg.start, seg.end);
            const src = seg.source;
            const flowId =
              src.kind === "flow" || src.kind === "interrupt" ? src.flowId : undefined;
            const flowType = flowId
              ? spec.flows.find((f) => f.id === flowId)?.type
              : undefined;
            const style = styleForSource(src, flowType);
            const clickable = isClickable(src.kind);
            const isEntry = src.kind === "flow" && src.flowId === spec.agent.entry_flow_id;
            const label = labelFor(src) + (isEntry ? " (entry)" : "");
            const body = bodyForDisplay(src.kind, text);
            return (
              <div key={i} className={`rounded-md px-2 py-1.5 ${style.block}`}>
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onSegmentClick(seg.source)}
                    title={clickHint(seg.source.kind)}
                    className={`mb-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 ${style.header} ${style.hover} ${style.ring}`}
                  >
                    <span className="flex-1 truncate">{label}</span>
                    <span aria-hidden>→</span>
                  </button>
                ) : (
                  <div
                    className={`mb-1 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.header}`}
                  >
                    {label}
                  </div>
                )}
                <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-zinc-800">
                  {body}
                </pre>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-1 flex-col p-3">
          <textarea
            value={editorValue}
            onChange={(e) => setPromptOverride(e.target.value)}
            spellCheck={false}
            className="block h-full w-full resize-none whitespace-pre-wrap rounded border border-zinc-200 bg-white p-2 font-mono text-[10px] leading-snug text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </div>
      )}
    </aside>
  );
}

function ToggleButton({
  active,
  onClick,
  dot,
  children,
}: {
  active: boolean;
  onClick: () => void;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-0.5 text-[11px] ${
        active ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50"
      }`}
    >
      {children}
      {dot && <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />}
    </button>
  );
}
