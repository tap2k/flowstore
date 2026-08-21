import { Fragment, useMemo, useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import {
  GLOSSARY_PREFIX,
  GLOSSARY_SEP,
  blockParts,
  displayCtx,
  type BlockPart,
  type FaqAnswer,
} from "@flowstore/core/codegen/promptDoc";
import {
  END_TARGET_TEXT,
  RETURN_TARGET_TEXT,
  ROLE_PRE,
  ROLE_TONE_PREFIX,
  TRIGGER_PREFIX,
  type PromptSource,
} from "@flowstore/core/codegen/promptGenerator";
import {
  setLanguage,
  GOTO_END,
  GOTO_RETURN,
  type Agent,
  type FaqEntry,
  type Flow,
  type Spec,
} from "@flowstore/core/schema/v0";
import { genId } from "@flowstore/core/ids";
import { DropdownMenu, type MenuItemSpec } from "@/components/ui";

// ─────────────────────────────────────────────────────────────────────────
// Inline editing for the System Prompt panel's View mode.
//
// Renders a segment's displayed body from its BlockPart model (promptDoc)
// instead of the raw text, swapping each entity-backed span for a
// click-to-edit control. Display framing (prefixes, quote characters, routing
// pre/mid/post, per-language labels) comes from the parts and core constants —
// this file states no prompt literals of its own, so the editable view cannot
// drift from the compiled prompt (promptDoc's round-trip tests pin the
// framing).
//
// Every commit writes ONE spec content field through the store; the whole
// prompt then re-renders from the spec, so part↔entity associations only ever
// have to survive a single edit. Deletes are toast-undoable (single-slot
// snapshot in the spec store) — no dialogs.
//
// The panel gates this to View mode with no Edit-raw override. Both render
// modes are editable: a pinned language, and the multilingual "auto" view
// (per-language script/FAQ lines each edit their own translation).
// ─────────────────────────────────────────────────────────────────────────

interface EditableBlockBodyProps {
  spec: Spec;
  source: PromptSource;
  language?: string;
  // Session-transient staleness marks for script lines edited in one language
  // while unseen translations exist ("flowId:scriptId"). Deliberately NOT a
  // schema field — UI state only.
  staleScripts: ReadonlySet<string>;
  markStale: (key: string) => void;
  onDeleted: (label: string) => void;
  inkClass: string;
}

// The draft editor shared by InlineText and GhostAdd. A grid-stacked
// invisible replica sizes the textarea to its soft-wrapped content, so the
// editor always shows the whole draft (no clipped single row) and grows as
// you type. Caret starts at the end; trimmed commit on blur / Enter (⌘Enter
// when multiline); Escape cancels. An empty commit is a cancel, never a write
// of "" — deletion is an explicit control, not an accidental clear.
function CommitTextarea({
  initial,
  onCommit,
  onDone,
  multiline = false,
  placeholder,
  className = "",
}: {
  initial: string;
  onCommit: (text: string) => void;
  onDone: () => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(initial);
  const commit = () => {
    onDone();
    const text = draft.trim();
    if (text && text !== initial) onCommit(text);
  };
  // Replica and textarea must share metrics (font, padding, border, wrapping)
  // for the auto-size to be exact. The zero-width space keeps a trailing
  // newline from collapsing.
  const metrics =
    "whitespace-pre-wrap break-words rounded border p-1 font-mono text-[10px] leading-snug";
  return (
    <span className={`grid w-full py-0.5 ${className}`}>
      <span aria-hidden className={`${metrics} invisible col-start-1 row-start-1 border-transparent`}>
        {(draft || placeholder || "") + "​"}
      </span>
      <textarea
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          const n = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(n, n);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          } else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          }
        }}
        spellCheck={false}
        className={`${metrics} col-start-1 row-start-1 h-full w-full resize-none overflow-hidden border-border-default bg-surface-sunken text-text-primary placeholder:italic placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-focus-ring`}
      />
    </span>
  );
}

// Click-to-edit text span.
function InlineText({
  value,
  onCommit,
  multiline = false,
  title,
}: {
  value: string;
  onCommit: (text: string) => void;
  multiline?: boolean;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={0}
        title={title ?? "Click to edit"}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className="cursor-text rounded px-px hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
      >
        {value || <span className="italic text-text-tertiary">empty</span>}
      </span>
    );
  }
  return (
    <CommitTextarea
      initial={value}
      multiline={multiline}
      onCommit={onCommit}
      onDone={() => setEditing(false)}
    />
  );
}

// "+ label" ghost row that opens an input; a non-empty commit calls onAdd.
function GhostAdd({ label, onAdd }: { label: string; onAdd: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="mt-0.5 rounded px-1 text-[10px] text-text-tertiary hover:bg-surface-hover hover:text-text-secondary"
      >
        + {label}
      </button>
    );
  }
  return (
    <CommitTextarea
      initial=""
      placeholder={label}
      onCommit={onAdd}
      onDone={() => setEditing(false)}
      className="mt-0.5"
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
      className="absolute right-0 top-0 rounded px-1 text-[10px] text-text-tertiary opacity-0 transition-opacity hover:bg-state-error-bg hover:text-state-error-fg group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-focus-ring"
    >
      ×
    </button>
  );
}

// Routing target: the rendered target phrase as a button opening a menu of
// flows + END/RETURN + new-flow. An unknown flow target shows the goto-unknown
// inline flag (warning styling) and this menu IS its quick-fix. Labels come
// from the spec and promptGenerator's target constants — never restated here.
function TargetPicker({
  spec,
  flowId,
  exitPathId,
  goto,
  targetText,
  targetUnknown,
}: {
  spec: Spec;
  flowId: string;
  exitPathId: string;
  goto: string;
  targetText: string;
  targetUnknown: boolean;
}) {
  const updateExitPath = useSpecStore((s) => s.updateExitPath);
  const addFlow = useSpecStore((s) => s.addFlow);
  const [naming, setNaming] = useState(false);

  const pick = (target: string) => updateExitPath(flowId, exitPathId, { goto: target });
  const items: MenuItemSpec[] = [
    ...spec.flows.map((f) => ({
      label: f.name || f.id,
      checked: f.id === goto,
      onSelect: () => pick(f.id),
    })),
    { separator: true },
    { label: END_TARGET_TEXT, checked: goto === GOTO_END, onSelect: () => pick(GOTO_END) },
    { label: RETURN_TARGET_TEXT, checked: goto === GOTO_RETURN, onSelect: () => pick(GOTO_RETURN) },
    { separator: true },
    { label: "New flow…", onSelect: () => setNaming(true) },
  ];

  if (naming) {
    return (
      <CommitTextarea
        initial=""
        placeholder="new flow name"
        onCommit={(name) => pick(addFlow(false, name))}
        onDone={() => setNaming(false)}
      />
    );
  }
  return (
    <DropdownMenu
      trigger={
        <button
          title={
            targetUnknown
              ? `goto "${goto}" does not match any flow — pick a target to fix`
              : "Change target"
          }
          className={`rounded px-px underline decoration-dotted underline-offset-2 hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring ${
            targetUnknown ? "bg-state-warning-bg text-state-warning-fg" : ""
          }`}
        >
          {targetUnknown ? `⚠ ${targetText}` : targetText}
        </button>
      }
      items={items}
    />
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

  const setFaq = (next: FaqEntry[]) => updateAgent({ knowledge: { ...knowledge, faq: next } });
  const setGlossary = (next: NonNullable<typeof knowledge>["glossary"]) =>
    updateAgent({ knowledge: { ...knowledge, glossary: next } });
  const setFlowFaq = (flowId: string, next: FaqEntry[]) =>
    updateFlow(flowId, { knowledge: { ...flow?.knowledge, faq: next } });

  // Route a FAQ mutation to the agent's or the owning flow's entry list.
  const patchFaqEntry = (
    p: Extract<BlockPart, { kind: "faq" }>,
    patch: (e: FaqEntry) => FaqEntry,
  ) => {
    const list = (p.flowId ? flow?.knowledge?.faq : knowledge?.faq) ?? [];
    const next = list.map((e) => (e.id === p.faqId ? patch(e) : e));
    if (p.flowId) setFlowFaq(p.flowId, next);
    else setFaq(next);
  };
  const deleteFaqEntry = (p: Extract<BlockPart, { kind: "faq" }>) => {
    const list = (p.flowId ? flow?.knowledge?.faq : knowledge?.faq) ?? [];
    const next = list.filter((e) => e.id !== p.faqId);
    if (p.flowId) setFlowFaq(p.flowId, next);
    else setFaq(next);
    onDeleted("FAQ entry deleted");
  };

  const commitScript = (p: Extract<BlockPart, { kind: "script" }>, text: string) => {
    if (!flow) return;
    updateFlow(p.flowId, {
      scripts: (flow.scripts ?? []).map((s) =>
        s.id === p.scriptId
          ? { ...s, text: setLanguage(s.text, p.lang, text, ctx.defaultLang) ?? "" }
          : s,
      ),
    });
    if (p.hasOtherLanguages) markStale(`${p.flowId}:${p.scriptId}`);
  };

  // Ghost-add anchors: the last part of each addable group.
  const lastOf = (pred: (p: BlockPart) => boolean) => parts.findLastIndex(pred);
  const lastFaq = source.kind === "knowledge" ? lastOf((p) => p.kind === "faq") : -1;
  const lastGlossary = source.kind === "knowledge" ? lastOf((p) => p.kind === "glossary") : -1;
  const lastFlowFaq = flow ? lastOf((p) => p.kind === "faq") : -1;
  const lastFlowGuardrail = flow ? lastOf((p) => p.kind === "flowGuardrail") : -1;

  const renderPart = (p: BlockPart) => {
    switch (p.kind) {
      case "plain": {
        const text = p.lines.join("\n");
        // An empty plain part is a block separator (e.g. FAQ vs GLOSSARY); the
        // space keeps the line's height in the pre-wrap layout.
        return text ? <div>{text}</div> : <div> </div>;
      }

      case "role":
        return (
          <div>
            {ROLE_PRE}
            <InlineText
              title="The name the agent inhabits (meta.identity)"
              value={p.identity}
              onCommit={(identity) => updateAgent({ meta: { identity } } as Partial<Agent>)}
            />
            {"."}
            {p.purpose !== "" && (
              <>
                {" "}
                <InlineText
                  title="What the agent is for (meta.purpose)"
                  value={p.purpose}
                  onCommit={(purpose) => updateAgent({ meta: { purpose } } as Partial<Agent>)}
                />
              </>
            )}
            {p.tone !== null && (
              <>
                {" " + ROLE_TONE_PREFIX}
                <InlineText
                  title="How the agent sounds (meta.tone)"
                  value={p.tone}
                  onCommit={(tone) => updateAgent({ meta: { tone } } as Partial<Agent>)}
                />
              </>
            )}
          </div>
        );

      case "guardrail":
        return (
          <div className="group/row relative pr-4">
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

      case "flowGuardrail":
        return (
          <div className="group/row relative pr-4">
            {p.pre}
            <InlineText
              value={p.statement}
              onCommit={(text) =>
                updateFlow(p.flowId, {
                  guardrails: (flow?.guardrails ?? []).map((g) =>
                    g.id === p.guardrailId ? { ...g, statement: text } : g,
                  ),
                })
              }
            />
            <DeleteX
              label="flow guardrail"
              onClick={() => {
                updateFlow(p.flowId, {
                  guardrails: (flow?.guardrails ?? []).filter((g) => g.id !== p.guardrailId),
                });
                onDeleted("Flow guardrail deleted");
              }}
            />
          </div>
        );

      case "faq":
        return (
          <div className="group/row relative pr-4">
            {p.qPre}
            <InlineText
              value={p.question}
              onCommit={(q) => patchFaqEntry(p, (e) => ({ ...e, question: q }))}
            />
            {p.answerHeader !== null && "\n" + p.answerHeader}
            {p.answers.map((a: FaqAnswer) => (
              <Fragment key={a.lang}>
                {"\n" + a.pre}
                <InlineText
                  value={a.text}
                  onCommit={(text) =>
                    patchFaqEntry(p, (e) => ({
                      ...e,
                      answer: setLanguage(e.answer, a.lang, text, ctx.defaultLang) ?? "",
                    }))
                  }
                />
              </Fragment>
            ))}
            <DeleteX label="FAQ entry" onClick={() => deleteFaqEntry(p)} />
          </div>
        );

      case "glossary":
        return (
          <div className="group/row relative pr-4">
            {GLOSSARY_PREFIX}
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
            {GLOSSARY_SEP}
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

      case "trigger":
        return (
          <div>
            {TRIGGER_PREFIX}
            <InlineText
              value={p.expression}
              title="Click to edit the interrupt trigger (free text)"
              onCommit={(expression) =>
                updateFlow(p.flowId, {
                  entry_condition: { ...flow!.entry_condition!, expression },
                })
              }
            />
          </div>
        );

      case "instructions":
        return (
          <div>
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
        // field. Variations are read-only display beneath the text line.
        const stale = p.hasOtherLanguages && staleScripts.has(`${p.flowId}:${p.scriptId}`);
        return (
          <div>
            {p.pre}
            <InlineText value={p.text} onCommit={(text) => commitScript(p, text)} />
            {p.post}
            {stale && (
              <span
                title={`Edited in ${p.lang} only — translations in other languages may be stale.`}
                className="ml-1 rounded bg-state-warning-bg px-1 text-[9px] font-sans text-state-warning-fg"
              >
                translations stale?
              </span>
            )}
            {p.variationLines.length > 0 && "\n" + p.variationLines.join("\n")}
          </div>
        );
      }

      case "routing": {
        if (p.readOnly) {
          return (
            <div
              title="Turn-budget escape — runtime-enforced, not model-facing. Edit via the flow inspector."
              className="opacity-70"
            >
              {p.lines.join("\n")}
            </div>
          );
        }
        const xp = flow?.exit_paths.find((x) => x.id === p.exitPathId);
        return (
          <div className="group/row relative pr-4">
            {p.pre}
            {p.expression !== null && xp?.condition && (
              <>
                <InlineText
                  value={p.expression}
                  title="Click to edit the condition (free text — the frame around it is generated)"
                  onCommit={(expression) =>
                    updateExitPath(p.flowId, p.exitPathId, {
                      condition: { ...xp.condition!, expression },
                    })
                  }
                />
                {p.mid}
              </>
            )}
            <TargetPicker
              spec={spec}
              flowId={p.flowId}
              exitPathId={p.exitPathId}
              goto={p.goto}
              targetText={p.targetText}
              targetUnknown={p.targetUnknown}
            />
            {p.post}
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
          {renderPart(p)}
          {i === lastFaq && (
            <GhostAdd
              label="Q&A (question first)"
              onAdd={(q) =>
                setFaq([...(knowledge?.faq ?? []), { id: genId("faq"), question: q, answer: "" }])
              }
            />
          )}
          {i === lastGlossary && (
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
          {flow && i === lastFlowFaq && (
            <GhostAdd
              label="Q&A (question first)"
              onAdd={(q) =>
                setFlowFaq(flow.id, [
                  ...(flow.knowledge?.faq ?? []),
                  { id: genId("faq"), question: q, answer: "" },
                ])
              }
            />
          )}
          {flow && i === lastFlowGuardrail && (
            <GhostAdd
              label="flow guardrail"
              onAdd={(statement) =>
                updateFlow(flow.id, {
                  guardrails: [...(flow.guardrails ?? []), { id: genId("g"), statement }],
                })
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
