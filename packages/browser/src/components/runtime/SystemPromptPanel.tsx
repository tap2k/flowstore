import { useMemo, useRef, useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import { useUiStore } from "@/lib/store/ui";
import {
  compileSystemPrompt,
  ALL_LANGUAGES,
  type PromptSource,
} from "@flowstore/core/codegen/promptGenerator";
// bodyForDisplay is the deliberate View-mode divergence from the raw compiled
// prompt (headers/numbering stripped). It lives in core promptDoc so the
// inline-editing part model can be round-trip-tested against it.
import { bodyForDisplay } from "@flowstore/core/codegen/promptDoc";
import {
  applyAllProseReferenceFixes,
  applyProseReferenceFix,
  findDanglingReferences,
  type ProseFieldRef,
  type ProseReference,
} from "@flowstore/core/validation/proseRefs";
import { INLINE_EDITABLE_KINDS } from "@flowstore/core/codegen/promptDoc";
import { type Spec } from "@flowstore/core/schema/v0";
import { styleForSource, isClickable, labelFor } from "@/lib/promptColors";
import {
  computeDiagnostics,
  diagnosticCounts,
  anchorLabel,
  flowName,
  type Diagnostic,
} from "@/lib/diagnostics";
import { DisclosureCaret, Toast } from "@/components/ui";
import { EditableBlockBody } from "./PromptBlockBody";

interface SystemPromptPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SystemPromptPanel({ open, onClose }: SystemPromptPanelProps) {
  const spec = useSpecStore((s) => s.spec);
  const requestFocus = useSpecStore((s) => s.requestFocus);
  const setSelection = useSpecStore((s) => s.setSelection);
  const undoLast = useSpecStore((s) => s.undoLast);
  const lastRename = useSpecStore((s) => s.lastRename);
  const clearLastRename = useSpecStore((s) => s.clearLastRename);
  const commitSpec = useSpecStore((s) => s.commitSpec);
  const promptOverride = useUiStore((s) => s.promptOverride);
  const setPromptOverride = useUiStore((s) => s.setPromptOverride);
  const promptOverrideSpecRef = useUiStore((s) => s.promptOverrideSpecRef);
  const setOpenSheet = useUiStore((s) => s.setOpenSheet);

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [problemsOpen, setProblemsOpen] = useState(true);
  const [copied, setCopied] = useState<"double" | "single" | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Session-transient inline-editing state: staleness marks for script lines
  // edited in one language ("flowId:scriptId"), and the one-slot undo toast
  // for inline deletes (visibility + reversibility instead of confirm dialogs).
  // The toast pins the store's undo snapshot at delete time: if a later
  // mutation replaces the snapshot, "Undo" would no longer reverse the delete,
  // so the toast hides itself (see toastLive below).
  const [staleScripts, setStaleScripts] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<{ label: string; snapshot: object } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSpec = useSpecStore((s) => s.prevSpec);
  const markStale = (key: string) => setStaleScripts((prev) => new Set(prev).add(key));
  function onDeleted(label: string) {
    setToast({ label, snapshot: useSpecStore.getState().prevSpec! });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }
  const toastLive = toast !== null && toast.snapshot === prevSpec;

  const availableLanguages = spec?.agent.meta.languages ?? [];
  // Default to "auto" (undefined → multilingual) so the inspector shows exactly
  // what an unpinned session sends. Pinning a code scopes to one language.
  const [language, setLanguage] = useState<string | undefined>(undefined);

  // Reset to auto when the agent changes, or when the current pick is no longer
  // one of its languages. Done during render (matches SimulatePanel) to avoid a
  // wasted commit.
  const prevAgentIdRef = useRef(spec?.agent.id);
  if (prevAgentIdRef.current !== spec?.agent.id) {
    prevAgentIdRef.current = spec?.agent.id;
    if (language !== undefined) setLanguage(undefined);
  } else if (language && !availableLanguages.includes(language)) {
    setLanguage(undefined);
  }

  // View shows the un-substituted template — the panel inspects the spec, not a
  // session, so there are no variable values to substitute. Unpinned → emit
  // every declared language (what an "auto" session receives).
  const compiled = useMemo(
    () => (spec ? compileSystemPrompt(spec, undefined, { language: language ?? ALL_LANGUAGES }) : null),
    [spec, language],
  );

  const diagnostics = useMemo(() => (spec ? computeDiagnostics(spec) : []), [spec]);

  // Rename-aware reference check: prose mentions of the renamed-away name,
  // offered as non-blocking quick-fixes (never auto-applied — a prose mention
  // may be caller-facing wording).
  // Gated on `open`: the scan walks every prose field and would otherwise run
  // (and be discarded) on each store mutation while the panel is closed.
  const renameRefs = useMemo(
    () => (open && spec && lastRename ? findDanglingReferences(spec, lastRename.from) : []),
    [open, spec, lastRename],
  );

  if (!open || !spec || !compiled) return null;

  const compiledText = compiled.text;
  const editorValue = promptOverride ?? compiledText;
  const edited = promptOverride !== null && promptOverride !== compiledText;

  // Inline editing needs a spec-faithful render: any language mode works (the
  // multilingual "auto" view edits each translation on its own labeled line),
  // but not while an Edit-raw override detaches the text from the spec. Only
  // consulted inside the View-mode branch.
  const inlineEnabled = !edited;
  const specChangedSinceEdit =
    promptOverride !== null && promptOverrideSpecRef !== null && promptOverrideSpecRef !== spec;
  const charsDiff = Math.abs(editorValue.length - compiledText.length);

  function revert() {
    setPromptOverride(null);
    setMode("view");
  }

  function copy(singleBracket = false) {
    // Copy yields the LITERAL prompt (compiledText / the edit buffer), never the
    // display-trimmed text — what you paste must match what the LLM receives.
    // See bodyForDisplay for the deliberate View-mode divergence.
    const text = mode === "edit" ? editorValue : compiledText;
    // Single-bracket export down-converts {{var}} → {var} for runtimes whose
    // interpolation is single-brace. Lossy by nature: any literal
    // single brace in the prompt becomes indistinguishable from a placeholder on
    // such a runtime — flowstore stays {{var}} internally; this is export-only.
    const out = singleBracket ? text.replace(/\{\{([A-Za-z_]\w*)\}\}/g, "{$1}") : text;
    void navigator.clipboard.writeText(out);
    setCopied(singleBracket ? "single" : "double");
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1500);
  }

  // A diagnostic is jumpable unless it's a schema error with no entity anchor.
  function canJump(d: Diagnostic): boolean {
    return d.at.kind !== "global" || d.source === "graph";
  }

  function jumpToDiagnostic(d: Diagnostic) {
    if (d.at.kind === "flow") {
      requestFocus("flow", d.at.flowId);
      setSelection({ kind: "flow", id: d.at.flowId });
    } else if (d.at.kind === "edge") {
      setSelection({ kind: "edge", flowId: d.at.flowId, exitPathId: d.at.exitPathId });
    } else if (d.source === "graph") {
      // entry-flow / system_prompt / global casing all live on the agent envelope.
      setOpenSheet("agent");
    }
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
    <aside className="relative flex flex-col h-full w-[380px] border-l border-border-default bg-surface-panel">
      <div className="flex items-center justify-between border-b border-border-default px-4 py-2">
        <div className="text-sm font-semibold text-text-primary">System prompt</div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => copy(false)}
            title="Copy the prompt with {{variable}} placeholders (flowstore's convention)."
            className={`rounded px-2 py-1 text-[11px] ${
              copied === "double" ? "text-state-success-fg" : "text-text-secondary hover:bg-surface-hover"
            }`}
          >
            {copied === "double" ? "copied ✓" : "copy"}
          </button>
          <button
            onClick={() => copy(true)}
            title="Copy with {{variable}} down-converted to single-brace {variable}, for runtimes with single-brace interpolation. Note: literal single braces in the prompt become ambiguous on those runtimes."
            className={`rounded px-2 py-1 text-[11px] ${
              copied === "single" ? "text-state-success-fg" : "text-text-secondary hover:bg-surface-hover"
            }`}
          >
            {copied === "single" ? "copied ✓" : "copy (single-bracket)"}
          </button>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover"
          >
            close
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-border-default px-4 py-1.5 text-[11px]">
        <div className="flex overflow-hidden rounded border border-border-default">
          <ToggleButton active={mode === "view"} onClick={() => setMode("view")}>
            View
          </ToggleButton>
          <ToggleButton active={mode === "edit"} onClick={() => setMode("edit")} dot={edited}>
            Edit raw
          </ToggleButton>
        </div>
        {availableLanguages.length > 1 && (
          <select
            value={language ?? ""}
            onChange={(e) => setLanguage(e.target.value || undefined)}
            disabled={mode === "edit"}
            title={
              mode === "edit"
                ? "Revert to change language"
                : "auto: every declared language (what an unpinned session sends). Pin a code to render scripts and FAQ in one language."
            }
            className="ml-auto rounded border border-border-default bg-surface-panel px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
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

      {diagnostics.length > 0 && (
        <ProblemsSection
          diagnostics={diagnostics}
          spec={spec}
          open={problemsOpen}
          onToggle={() => setProblemsOpen((v) => !v)}
          canJump={canJump}
          onJump={jumpToDiagnostic}
        />
      )}

      {lastRename && renameRefs.length > 0 && (
        <RenameFixups
          spec={spec}
          from={lastRename.from}
          to={lastRename.to}
          refs={renameRefs}
          onFixOne={(ref) => commitSpec(applyProseReferenceFix(spec, ref, lastRename.from, lastRename.to))}
          onFixAll={() => {
            commitSpec(applyAllProseReferenceFixes(spec, renameRefs, lastRename.from, lastRename.to));
            clearLastRename();
          }}
          onDismiss={clearLastRename}
        />
      )}

      {(specChangedSinceEdit || edited) && (
        <div className="flex items-center justify-between gap-2 border-b border-state-warning-line bg-state-warning-bg px-3 py-2 text-[11px] text-state-warning-fg">
          <span>
            {specChangedSinceEdit
              ? "Spec changed since edit"
              : `Edited · ${charsDiff.toLocaleString()} chars different`}
          </span>
          <button
            onClick={revert}
            className="rounded border border-state-warning-line bg-surface-panel px-2 py-0.5 text-state-warning-fg hover:bg-state-warning-bg"
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
            const inline = inlineEnabled && INLINE_EDITABLE_KINDS.has(src.kind);
            return (
              <div key={i} className={`rounded-md px-2 py-1.5 ${style.block}`}>
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onSegmentClick(seg.source)}
                    title="Open"
                    className={`group/seg mb-1 flex w-full cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 ${style.header} ${style.hover} ${style.ring}`}
                  >
                    <span className="flex-1 truncate">{label}</span>
                    <span className="truncate text-[9px] font-normal normal-case opacity-60 transition-opacity group-hover/seg:opacity-100">
                      Open
                    </span>
                    <span aria-hidden className="transition-transform group-hover/seg:translate-x-0.5">
                      →
                    </span>
                  </button>
                ) : (
                  <div
                    className={`mb-1 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.header}`}
                  >
                    {label}
                  </div>
                )}
                {inline ? (
                  <EditableBlockBody
                    spec={spec}
                    source={src}
                    language={language}
                    staleScripts={staleScripts}
                    markStale={markStale}
                    onDeleted={onDeleted}
                    inkClass={style.body ?? "text-text-primary"}
                  />
                ) : (
                  <pre
                    className={`whitespace-pre-wrap break-words font-mono text-[10px] leading-snug ${
                      style.body ?? "text-text-primary"
                    }`}
                  >
                    {bodyForDisplay(src.kind, text)}
                  </pre>
                )}
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
            className="block h-full w-full resize-none whitespace-pre-wrap rounded border border-border-default bg-surface-panel p-2 font-mono text-[10px] leading-snug text-text-secondary focus:outline-none focus:ring-1 focus:ring-focus-ring"
          />
        </div>
      )}

      {toastLive && (
        <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
          <Toast
            message={toast.label}
            actionLabel="Undo"
            action={() => {
              undoLast();
              setToast(null);
            }}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}
    </aside>
  );
}

// Non-blocking rename fix-ups: after a flow/variable rename, prose fields that
// still mention the old name get one-click replacements. Never auto-applied.
function RenameFixups({
  spec,
  from,
  to,
  refs,
  onFixOne,
  onFixAll,
  onDismiss,
}: {
  spec: Spec;
  from: string;
  to: string;
  refs: ProseReference[];
  onFixOne: (ref: ProseFieldRef) => void;
  onFixAll: () => void;
  onDismiss: () => void;
}) {
  const label = (ref: ProseFieldRef): string => {
    switch (ref.field) {
      case "instructions":
        return `instructions · ${flowName(spec, ref.flowId)}`;
      case "entry-condition":
        return `trigger · ${flowName(spec, ref.flowId)}`;
      case "exit-condition":
        return `exit condition · ${flowName(spec, ref.flowId)}`;
      case "faq-answer":
        return ref.flowId ? `FAQ answer · ${flowName(spec, ref.flowId)}` : "FAQ answer · agent";
      case "script":
        return `script · ${flowName(spec, ref.flowId)}`;
    }
  };
  const total = refs.reduce((n, r) => n + r.count, 0);
  return (
    <div className="border-b border-state-warning-line bg-state-warning-bg px-3 py-2 text-[11px]">
      <div className="flex items-center justify-between gap-2 text-state-warning-fg">
        <span>
          Renamed “{from}” → “{to}” — {total} stale mention{total === 1 ? "" : "s"} in prose
        </span>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={onFixAll}
            className="rounded border border-state-warning-line bg-surface-panel px-2 py-0.5 hover:bg-state-warning-bg"
          >
            Fix all
          </button>
          <button onClick={onDismiss} className="rounded px-1.5 py-0.5 hover:bg-state-warning-bg">
            Dismiss
          </button>
        </div>
      </div>
      <ul className="mt-1 space-y-0.5">
        {refs.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="truncate text-state-warning-fg">
              {label(r.ref)}
              {r.count > 1 ? ` · ${r.count}×` : ""}
            </span>
            <button
              onClick={() => onFixOne(r.ref)}
              className="shrink-0 rounded border border-state-warning-line bg-surface-panel px-2 py-0.5 text-state-warning-fg hover:bg-state-warning-bg"
            >
              Fix
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// IDE-style Problems pane for the compile output: errors then warnings, each
// row click-jumps to its anchor (flow/edge on canvas, or the agent sheet).
function ProblemsSection({
  diagnostics,
  spec,
  open,
  onToggle,
  canJump,
  onJump,
}: {
  diagnostics: Diagnostic[];
  spec: Spec;
  open: boolean;
  onToggle: () => void;
  canJump: (d: Diagnostic) => boolean;
  onJump: (d: Diagnostic) => void;
}) {
  const { errors, warnings } = diagnosticCounts(diagnostics);
  return (
    <div className="border-b border-border-default text-[11px]">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-1.5 hover:bg-surface-hover"
      >
        <span className="font-semibold text-text-primary">Problems</span>
        {errors > 0 && <Count tone="error" n={errors} />}
        {warnings > 0 && <Count tone="warning" n={warnings} />}
        <DisclosureCaret open={open} className="ml-auto" />
      </button>
      {open && (
        <ul className="max-h-48 overflow-auto px-2 pb-2">
          {diagnostics.map((d, i) => {
            const jumpable = canJump(d);
            return (
              <li key={i}>
                <button
                  disabled={!jumpable}
                  onClick={() => onJump(d)}
                  title={jumpable ? "Jump to source" : undefined}
                  className={`flex w-full items-start gap-2 rounded px-2 py-1 text-left ${
                    jumpable ? "cursor-pointer hover:bg-surface-hover" : "cursor-default"
                  }`}
                >
                  <span
                    className={`mt-px ${d.severity === "error" ? "text-state-error-line" : "text-state-warning-fg"}`}
                    aria-label={d.severity}
                  >
                    {d.severity === "error" ? "●" : "▲"}
                  </span>
                  <span className="flex-1">
                    <span className="text-text-primary">{d.message}</span>
                    <span className="ml-1 whitespace-nowrap text-text-tertiary">· {anchorLabel(d.at, spec)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Count({ tone, n }: { tone: "error" | "warning"; n: number }) {
  const cls = tone === "error" ? "bg-state-error-bg text-state-error-fg" : "bg-state-warning-bg text-state-warning-fg";
  const noun = tone === "error" ? "error" : "warning";
  return (
    <span className={`rounded px-1.5 py-0.5 ${cls}`}>
      {n} {n === 1 ? noun : `${noun}s`}
    </span>
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
        active ? "bg-emphasis text-emphasis-fg" : "bg-surface-panel text-text-secondary hover:bg-surface-hover"
      }`}
    >
      {children}
      {dot && <span className="inline-block h-1.5 w-1.5 rounded-full bg-state-warning-line" aria-hidden />}
    </button>
  );
}
