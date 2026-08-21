import { Fragment, useMemo, useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import {
  blockParts,
  displayCtx,
  type BlockPart,
} from "@flowstore/core/codegen/promptDoc";
import { conditionFrame, type PromptSource } from "@flowstore/core/codegen/promptGenerator";
import {
  isFlowGoto,
  setLanguage,
  GOTO_END,
  GOTO_RETURN,
  type Flow,
  type Spec,
} from "@flowstore/core/schema/v0";
import { genId } from "@flowstore/core/ids";

// ─────────────────────────────────────────────────────────────────────────
// Inline editing for the System Prompt panel's View mode.
//
// Renders a segment's displayed body from its BlockPart model (promptDoc)
// instead of the raw text, swapping each entity-backed span for a
// click-to-edit control. Every commit writes ONE spec content field through
// the store; the whole prompt then re-renders from the spec, so part↔entity
// associations only ever have to survive a single edit. Deletes are
// toast-undoable (single-slot snapshot in the spec store) — no dialogs.
//
// The panel gates this to: View mode, no Edit-raw override, pinned-language
// render. promptDoc's builders assume exactly that state.
// ─────────────────────────────────────────────────────────────────────────

interface EditableBlockBodyProps {
  spec: Spec;
  source: PromptSource;
  language?: string;
  // Session-transient staleness marks for script lines edited in one language
  // while translations exist ("flowId:scriptId"). Deliberately NOT a schema
  // field — UI state only.
  staleScripts: ReadonlySet<string>;
  markStale: (key: string) => void;
  onDeleted: (label: string) => void;
  inkClass: string;
}

// Click-to-edit text. Commits the trimmed draft on blur / Enter (⌘Enter when
// multiline); Escape cancels; an empty commit cancels rather than writing ""
// (deletion is an explicit control, never an accidental clear).
function InlineText({
  value,
  onCommit,
  multiline = false,
  placeholder = "empty",
  title,
}: {
  value: string;
  onCommit: (text: string) => void;
  multiline?: boolean;
  placeholder?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <span
        role="button"
        tabIndex={0}
        title={title ?? "Click to edit"}
        onClick={() => setDraft(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setDraft(value);
          }
        }}
        className="cursor-text rounded px-px hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
      >
        {value || <span className="italic text-text-tertiary">{placeholder}</span>}
      </span>
    );
  }

  const commit = () => {
    const text = draft.trim();
    setDraft(null);
    if (text && text !== value) onCommit(text);
  };
  return (
    <textarea
      autoFocus
      value={draft}
      rows={Math.max(1, draft.split("\n").length)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        const n = e.currentTarget.value.length;
        e.currentTarget.setSelectionRange(n, n);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          setDraft(null);
        } else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        }
      }}
      spellCheck={false}
      className="block w-full resize-none rounded border border-border-default bg-surface-panel p-1 font-mono text-[10px] leading-snug text-text-primary focus:outline-none focus:ring-1 focus:ring-focus-ring"
    />
  );
}

// "+ label" ghost row that opens an input; a non-empty commit calls onAdd.
function GhostAdd({ label, onAdd }: { label: string; onAdd: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button
        onClick={() => setDraft("")}
        className="mt-0.5 rounded px-1 text-[10px] text-text-tertiary hover:bg-surface-hover hover:text-text-secondary"
      >
        + {label}
      </button>
    );
  }
  const commit = () => {
    const text = draft.trim();
    setDraft(null);
    if (text) onAdd(text);
  };
  return (
    <textarea
      autoFocus
      value={draft}
      rows={Math.max(1, draft.split("\n").length)}
      placeholder={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          setDraft(null);
        } else if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      spellCheck={false}
      className="mt-0.5 block w-full resize-none rounded border border-border-default bg-surface-panel p-1 font-mono text-[10px] leading-snug text-text-primary focus:outline-none focus:ring-1 focus:ring-focus-ring"
    />
  );
}

// Hover-revealed delete control for a part row (the row supplies group/row).
function DeleteX({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={`Delete ${label}`}
      title={`Delete ${label}`}
      className="absolute right-0 top-0 rounded px-1 text-[10px] text-text-tertiary opacity-0 transition-opacity hover:bg-state-error-bg hover:text-state-error-fg group-hover/row:opacity-100"
    >
      ×
    </button>
  );
}

// Routing target: the rendered target phrase as a button; picking rewires the
// exit path's goto. An unknown flow target shows the goto-unknown inline flag
// (warning styling) and this popover IS its quick-fix.
function TargetPicker({
  spec,
  flowId,
  exitPathId,
  goto,
  targetText,
}: {
  spec: Spec;
  flowId: string;
  exitPathId: string;
  goto: string;
  targetText: string;
}) {
  const updateExitPath = useSpecStore((s) => s.updateExitPath);
  const updateFlow = useSpecStore((s) => s.updateFlow);
  const addFlow = useSpecStore((s) => s.addFlow);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const unknown = isFlowGoto(goto) && !spec.flows.some((f) => f.id === goto);

  const pick = (target: string) => {
    updateExitPath(flowId, exitPathId, { goto: target });
    setOpen(false);
  };
  const createFlow = () => {
    const name = newName.trim();
    if (!name) return;
    const id = addFlow(false, name);
    updateFlow(id, { name });
    pick(id);
    setNewName("");
  };

  const option = (label: string, value: string, mono = false) => (
    <button
      key={value}
      onClick={() => pick(value)}
      className={`block w-full px-2 py-0.5 text-left text-[10px] hover:bg-surface-hover ${
        mono ? "font-mono" : ""
      } ${value === goto ? "font-semibold text-text-primary" : "text-text-secondary"}`}
    >
      {label}
      {value === goto ? " ✓" : ""}
    </button>
  );

  return (
    <span className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        title={
          unknown
            ? `goto "${goto}" does not match any flow — pick a target to fix`
            : "Change target"
        }
        className={`rounded px-px underline decoration-dotted underline-offset-2 hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring ${
          unknown ? "bg-state-warning-bg text-state-warning-fg" : ""
        }`}
      >
        {unknown ? `⚠ ${targetText}` : targetText}
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <span className="absolute left-0 top-full z-20 mt-1 block max-h-56 w-56 overflow-auto whitespace-normal rounded border border-border-default bg-surface-panel py-1 font-sans shadow-lg">
            {spec.flows.map((f) => option(f.name || f.id, f.id))}
            <span className="my-1 block border-t border-border-default" />
            {option("end the conversation", GOTO_END)}
            {option("return to the calling flow", GOTO_RETURN)}
            <span className="my-1 block border-t border-border-default" />
            <span className="flex items-center gap-1 px-2 py-0.5">
              <input
                value={newName}
                placeholder="new flow…"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    createFlow();
                  }
                }}
                className="w-full rounded border border-border-default bg-surface-panel px-1 py-0.5 text-[10px] text-text-primary focus:outline-none focus:ring-1 focus:ring-focus-ring"
              />
            </span>
          </span>
        </>
      )}
    </span>
  );
}

export function EditableBlockBody({
  spec,
  source,
  language,
  staleScripts,
  markStale,
  onDeleted,
  inkClass,
}: EditableBlockBodyProps) {
  const updateAgent = useSpecStore((s) => s.updateAgent);
  const updateFlow = useSpecStore((s) => s.updateFlow);
  const updateExitPath = useSpecStore((s) => s.updateExitPath);
  const addExitPath = useSpecStore((s) => s.addExitPath);
  const removeExitPath = useSpecStore((s) => s.removeExitPath);

  const ctx = useMemo(() => displayCtx(spec, language), [spec, language]);
  const parts = useMemo(() => blockParts(spec, source, ctx), [spec, source, ctx]);
  if (!parts) return null;

  const guardrails = spec.agent.guardrails ?? [];
  const knowledge = spec.agent.knowledge;
  const flow: Flow | undefined =
    source.kind === "flow" || source.kind === "interrupt"
      ? spec.flows.find((f) => f.id === source.flowId)
      : undefined;

  const setFaq = (next: NonNullable<typeof knowledge>["faq"]) =>
    updateAgent({ knowledge: { ...knowledge, faq: next } });
  const setGlossary = (next: NonNullable<typeof knowledge>["glossary"]) =>
    updateAgent({ knowledge: { ...knowledge, glossary: next } });

  const commitScript = (p: Extract<BlockPart, { kind: "script" }>, text: string) => {
    if (!flow) return;
    updateFlow(p.flowId, {
      scripts: (flow.scripts ?? []).map((s) =>
        s.id === p.scriptId
          ? { ...s, text: setLanguage(s.text, ctx.lang, text, ctx.defaultLang) ?? "" }
          : s,
      ),
    });
    if (p.hasOtherLanguages) markStale(`${p.flowId}:${p.scriptId}`);
  };

  const lastOfKind = (kind: BlockPart["kind"]) =>
    parts.reduce((last, p, i) => (p.kind === kind ? i : last), -1);
  const lastFaq = lastOfKind("faq");
  const lastGlossary = lastOfKind("glossary");

  const renderPart = (p: BlockPart, i: number) => {
    switch (p.kind) {
      case "plain": {
        const text = p.lines.join("\n");
        return text ? <div key={i}>{text}</div> : <div key={i}>{" "}</div>;
      }

      case "guardrail":
        return (
          <div key={p.guardrailId} className="group/row relative pr-4">
            {p.prefix}
            <InlineText
              value={p.statement}
              onCommit={(text) =>
                updateAgent({
                  guardrails: guardrails.map((g) =>
                    g.id === p.guardrailId ? { ...g, statement: text } : g,
                  ),
                })
              }
            />
            <DeleteX
              label="guardrail"
              onClick={() => {
                updateAgent({ guardrails: guardrails.filter((g) => g.id !== p.guardrailId) });
                onDeleted("Guardrail deleted");
              }}
            />
          </div>
        );

      case "faq":
        return (
          <div key={p.faqId} className="group/row relative pr-4">
            {"- Q: "}
            <InlineText
              value={p.question}
              onCommit={(q) =>
                setFaq(
                  (knowledge?.faq ?? []).map((e) =>
                    e.id === p.faqId ? { ...e, question: q } : e,
                  ),
                )
              }
            />
            {"\n  A: "}
            <InlineText
              value={p.answer}
              onCommit={(a) =>
                setFaq(
                  (knowledge?.faq ?? []).map((e) =>
                    e.id === p.faqId
                      ? { ...e, answer: setLanguage(e.answer, ctx.lang, a, ctx.defaultLang) ?? "" }
                      : e,
                  ),
                )
              }
            />
            <DeleteX
              label="FAQ entry"
              onClick={() => {
                setFaq((knowledge?.faq ?? []).filter((e) => e.id !== p.faqId));
                onDeleted("FAQ entry deleted");
              }}
            />
          </div>
        );

      case "glossary":
        return (
          <div key={p.glossaryId} className="group/row relative pr-4">
            {"- "}
            <InlineText
              value={p.term}
              onCommit={(term) =>
                setGlossary(
                  (knowledge?.glossary ?? []).map((g) =>
                    g.id === p.glossaryId ? { ...g, term } : g,
                  ),
                )
              }
            />
            {": "}
            <InlineText
              value={p.definition}
              onCommit={(definition) =>
                setGlossary(
                  (knowledge?.glossary ?? []).map((g) =>
                    g.id === p.glossaryId ? { ...g, definition } : g,
                  ),
                )
              }
            />
            <DeleteX
              label="glossary term"
              onClick={() => {
                setGlossary((knowledge?.glossary ?? []).filter((g) => g.id !== p.glossaryId));
                onDeleted("Glossary term deleted");
              }}
            />
          </div>
        );

      case "instructions":
        return (
          <div key={i}>
            <InlineText
              multiline
              value={p.text}
              title="Click to edit instructions (⌘Enter to save)"
              onCommit={(text) => updateFlow(p.flowId, { instructions: text })}
            />
          </div>
        );

      case "script": {
        // The display shows quote-escaped text; the editable value is the raw
        // field. Variation lines trail the text's lines in p.lines.
        const textLineCount = p.text.split("\n").length;
        const variationLines = p.lines.slice(textLineCount);
        const stale = staleScripts.has(`${p.flowId}:${p.scriptId}`);
        return (
          <div key={p.scriptId}>
            {'  - "'}
            <InlineText value={p.text} onCommit={(text) => commitScript(p, text)} />
            {'"'}
            {stale && (
              <span
                title={`Edited in ${ctx.lang} only — translations in other languages may be stale.`}
                className="ml-1 rounded bg-state-warning-bg px-1 text-[9px] font-sans text-state-warning-fg"
              >
                translations stale?
              </span>
            )}
            {variationLines.length > 0 && "\n" + variationLines.join("\n")}
          </div>
        );
      }

      case "routing": {
        if (p.readOnly) {
          return (
            <div
              key={p.exitPathId}
              title="Turn-budget escape — runtime-enforced, not model-facing. Edit via the flow inspector."
              className="opacity-70"
            >
              {p.lines.join("\n")}
            </div>
          );
        }
        const xp = flow?.exit_paths.find((x) => x.id === p.exitPathId);
        const frame = p.method ? conditionFrame(p.method) : null;
        return (
          <div key={p.exitPathId} className="group/row relative pr-4">
            {"- "}
            {p.expression !== null && frame && xp?.condition ? (
              <>
                {frame.pre}
                <InlineText
                  value={p.expression}
                  title="Click to edit the condition (free text — the frame around it is generated)"
                  onCommit={(expression) =>
                    updateExitPath(p.flowId, p.exitPathId, {
                      condition: { ...xp.condition!, expression },
                    })
                  }
                />
                {frame.post}
                {", "}
              </>
            ) : (
              "Otherwise, "
            )}
            <TargetPicker
              spec={spec}
              flowId={p.flowId}
              exitPathId={p.exitPathId}
              goto={p.goto}
              targetText={p.targetText}
            />
            {"."}
            <DeleteX
              label="exit path"
              onClick={() => {
                removeExitPath(p.flowId, p.exitPathId);
                onDeleted("Exit path deleted");
              }}
            />
          </div>
        );
      }
    }
  };

  return (
    <div
      className={`whitespace-pre-wrap break-words font-mono text-[10px] leading-snug ${inkClass}`}
    >
      {parts.map((p, i) => (
        <Fragment key={i}>
          {renderPart(p, i)}
          {source.kind === "knowledge" && i === lastFaq && (
            <GhostAdd
              label="Q&A (question first)"
              onAdd={(q) =>
                setFaq([...(knowledge?.faq ?? []), { id: genId("faq"), question: q, answer: "" }])
              }
            />
          )}
          {source.kind === "knowledge" && i === lastGlossary && (
            <GhostAdd
              label="glossary term"
              onAdd={(term) =>
                setGlossary([
                  ...(knowledge?.glossary ?? []),
                  { id: genId("gloss"), term, definition: "" },
                ])
              }
            />
          )}
        </Fragment>
      ))}
      {source.kind === "guardrails" && (
        <GhostAdd
          label="guardrail"
          onAdd={(statement) =>
            updateAgent({ guardrails: [...guardrails, { id: genId("g"), statement }] })
          }
        />
      )}
      {flow && (
        <button
          onClick={() => addExitPath(flow.id, null)}
          className="mt-0.5 rounded px-1 text-[10px] text-text-tertiary hover:bg-surface-hover hover:text-text-secondary"
        >
          + exit path
        </button>
      )}
    </div>
  );
}
