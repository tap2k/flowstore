import { useMemo, useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import { useSettingsStore } from "@/lib/store/settings";
import type { Flow, FlowType, Guardrail, Condition } from "@flowstore/core/schema/v0";
import { defaultLanguage, isEndGoto, isReturnGoto } from "@flowstore/core/schema/v0";
import { genId } from "@flowstore/core/ids";
import { ListEditor } from "./ListEditor";
import { FaqListEditor } from "./FaqListEditor";
import { VariablesEditor } from "./VariablesEditor";
import { ConditionEditor } from "./ConditionEditor";
import { ScriptsSheet } from "@/components/sheets/ScriptsSheet";
import { CommentsSection } from "./CommentsSection";
import { LoadInSimButton } from "./LoadInSimButton";

const FLOW_TYPES: FlowType[] = ["happy", "sad", "off", "utility", "interrupt"];

const labelClass = "block fs-label text-text-secondary mb-1";
const inputClass =
  "w-full rounded border border-border-default px-2 py-1 fs-caption bg-surface-panel focus:outline-none focus:ring-1 focus:ring-focus-ring";
const textareaClass = `${inputClass} font-mono resize-y min-h-[80px]`;

export function FlowInspector() {
  const selection = useSpecStore((s) => s.selection);
  const flow = useSpecStore((s) =>
    selection?.kind === "flow" ? s.spec?.flows.find((f) => f.id === selection.id) ?? null : null
  );
  const languages = useSpecStore((s) => s.spec?.agent.meta.languages);
  const capabilities = useSpecStore((s) => s.spec?.agent.capabilities);
  const retrievalCaps = useMemo(
    () => (capabilities ?? []).filter((c) => c.kind === "retrieval"),
    [capabilities],
  );
  const flows = useSpecStore((s) => s.spec?.flows) ?? [];
  const updateFlow = useSpecStore((s) => s.updateFlow);
  const removeFlow = useSpecStore((s) => s.removeFlow);
  const setSelection = useSpecStore((s) => s.setSelection);
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [retrievalPickerOpen, setRetrievalPickerOpen] = useState(false);
  const [toolsPickerOpen, setToolsPickerOpen] = useState(false);
  const runnerUrl = useSettingsStore((s) => s.runnerUrl);
  // retrieve_on_turn and tools scoping execute only in the runner — prompt
  // mode never pre-fires retrieval and never scopes the tool set per flow —
  // so only surface the editors when a runner is plausibly in play (mirrors
  // the visible_when gate). Existing data always shows: an imported spec must
  // never hold behavior the author can't see or remove.
  const runnerFeatures = import.meta.env.VITE_DEV === "1" || runnerUrl !== "";

  if (!flow) return null;

  const defaultLang = defaultLanguage(languages);

  function patch(p: Partial<Flow>) {
    if (!flow) return;
    updateFlow(flow.id, p);
  }

  const isInterrupt = flow.type === "interrupt";
  const flowId = flow.id;

  function destLabel(goto: string): string {
    if (isEndGoto(goto)) return "End conversation";
    if (isReturnGoto(goto)) return "Return to caller";
    return flows.find((f) => f.id === goto)?.name ?? goto;
  }

  return (
    <aside className="w-[380px] shrink-0 border-l border-border-default bg-surface-panel overflow-y-auto">
      <div className="sticky top-0 bg-surface-panel border-b border-border-default px-4 py-3 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-text-tertiary">Flow</span>
        <span className="fs-caption text-text-tertiary font-mono truncate">{flow.id}</span>
        <button
          onClick={() => setSelection(null)}
          className="ml-auto fs-caption text-text-tertiary hover:text-text-primary"
        >
          close
        </button>
      </div>

      <div className="p-4 space-y-4">
        <Field label="Name">
          <input
            className={inputClass}
            value={flow.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>

        <Field label="Type">
          <select
            className={inputClass}
            value={flow.type}
            onChange={(e) => patch({ type: e.target.value as FlowType })}
          >
            {FLOW_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        {isInterrupt && (
          <Field label="Entry condition">
            <ConditionEditor
              condition={flow.entry_condition}
              onChange={(c: Condition | undefined) => patch({ entry_condition: c })}
              placeholder="Trigger phrase or intent that fires this interrupt"
            />
          </Field>
        )}

        <Field label="Instructions">
          <textarea
            className={textareaClass}
            value={flow.instructions ?? ""}
            onChange={(e) => patch({ instructions: e.target.value || undefined })}
            placeholder="Behavioral prose: what to do, how to behave, what to ask."
          />
        </Field>

        <Field label="Exit paths">
          {(flow.exit_paths ?? []).length === 0 ? (
            <div className="fs-caption text-text-tertiary italic">
              (none — drag from this node on the canvas to add one)
            </div>
          ) : (
            <div className="space-y-1.5">
              {(flow.exit_paths ?? []).map((xp) => (
                <button
                  key={xp.id}
                  type="button"
                  onClick={() =>
                    setSelection({ kind: "edge", flowId, exitPathId: xp.id })
                  }
                  className="block w-full text-left rounded border border-border-default px-2 py-1.5 fs-caption hover:bg-surface-hover hover:border-border-strong"
                >
                  <div className="flex items-center gap-1.5">
                    {xp.condition && (
                      <span className="shrink-0 rounded bg-surface-sunken px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-text-tertiary">
                        {xp.condition.method}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-text-secondary">
                      {xp.max_turns != null
                        ? `after ${xp.max_turns} turn${xp.max_turns === 1 ? "" : "s"}`
                        : xp.condition?.expression || "unconditional"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-text-tertiary">→ {destLabel(xp.goto)}</div>
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label="Notes">
          <textarea
            className={`${inputClass} resize-y min-h-[60px]`}
            value={flow.notes ?? ""}
            onChange={(e) => patch({ notes: e.target.value || undefined })}
            placeholder="Notes, comments, etc."
          />
        </Field>

        {import.meta.env.VITE_DEV === "1" && (
          <Field label="Guardrails">
            <ListEditor<Guardrail>
              items={flow.guardrails ?? []}
              onChange={(g) => patch({ guardrails: g.length ? g : undefined })}
              newItem={() => ({ id: genId("g"), statement: "" })}
              addLabel="add guardrail"
              emptyLabel="(none)"
              renderItem={(g, update, remove) => (
                <div className="flex items-start gap-2">
                  <textarea
                    className={`${inputClass} resize-y min-h-[40px]`}
                    value={g.statement}
                    onChange={(e) => update({ ...g, statement: e.target.value })}
                    placeholder="Behavioral invariant"
                  />
                  <button
                    onClick={remove}
                    className="fs-caption text-text-tertiary hover:text-state-error-fg mt-1"
                    title="remove"
                  >
                    ×
                  </button>
                </div>
              )}
            />
          </Field>
        )}

        {import.meta.env.VITE_DEV === "1" && (
          <Field label="FAQ">
            <FaqListEditor
              entries={flow.knowledge?.faq ?? []}
              onChange={(faq) =>
                patch({ knowledge: faq.length ? { faq } : undefined })
              }
              defaultLang={defaultLang}
              emptyLabel="(none)"
            />
          </Field>
        )}

        {(runnerFeatures || (flow.retrieve_on_turn ?? []).length > 0) &&
          retrievalCaps.length > 0 && (() => {
          const selectedIds = flow.retrieve_on_turn ?? [];
          const selectedCaps = selectedIds
            .map((id) => retrievalCaps.find((c) => c.id === id))
            .filter((c): c is NonNullable<typeof c> => Boolean(c));
          const unselectedCaps = retrievalCaps.filter(
            (c) => !selectedIds.includes(c.id),
          );

          return (
            <Field label="Retrieve on turn">
              <div className="space-y-2">
                {selectedCaps.length === 0 && (
                  <div className="fs-caption text-text-tertiary italic">(none)</div>
                )}
                {selectedCaps.map((cap) => (
                  <div
                    key={cap.id}
                    className="flex items-start gap-2 rounded border border-border-default px-2 py-1.5 fs-caption"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-text-primary truncate">{cap.name}</div>
                      {cap.description && (
                        <div className="text-text-tertiary mt-0.5">{cap.description}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = selectedIds.filter((id) => id !== cap.id);
                        patch({
                          retrieve_on_turn: next.length ? next : undefined,
                        });
                      }}
                      className="text-text-tertiary hover:text-state-error-fg leading-none"
                      title="remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {unselectedCaps.length > 0 &&
                  (retrievalPickerOpen ? (
                    <select
                      autoFocus
                      className={inputClass}
                      defaultValue=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return;
                        patch({
                          retrieve_on_turn: [...selectedIds, id],
                        });
                        setRetrievalPickerOpen(false);
                      }}
                      onBlur={() => setRetrievalPickerOpen(false)}
                    >
                      <option value="" disabled>
                        Select retrieval capability…
                      </option>
                      {unselectedCaps.map((cap) => (
                        <option key={cap.id} value={cap.id}>
                          {cap.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRetrievalPickerOpen(true)}
                      className="fs-caption text-text-secondary hover:text-text-primary underline"
                    >
                      + Add retrieval
                    </button>
                  ))}
              </div>
            </Field>
          );
        })()}

        {(runnerFeatures || (flow.tools ?? []).length > 0) &&
          (capabilities ?? []).length > 0 && (() => {
          const allCaps = capabilities ?? [];
          const selectedIds = flow.tools ?? [];
          const selectedCaps = selectedIds
            .map((id) => allCaps.find((c) => c.id === id))
            .filter((c): c is NonNullable<typeof c> => Boolean(c));
          const unselectedCaps = allCaps.filter((c) => !selectedIds.includes(c.id));

          return (
            <Field label="Tools (available in this flow)">
              <div className="space-y-2">
                {selectedCaps.length === 0 && (
                  <div className="fs-caption text-text-tertiary italic">
                    (none listed — all capabilities available)
                  </div>
                )}
                {selectedCaps.map((cap) => (
                  <div
                    key={cap.id}
                    className="flex items-start gap-2 rounded border border-border-default px-2 py-1.5 fs-caption"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-text-primary truncate">{cap.name}</div>
                      {cap.description && (
                        <div className="text-text-tertiary mt-0.5">{cap.description}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = selectedIds.filter((id) => id !== cap.id);
                        patch({ tools: next.length ? next : undefined });
                      }}
                      className="text-text-tertiary hover:text-state-error-fg leading-none"
                      title="remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {unselectedCaps.length > 0 &&
                  (toolsPickerOpen ? (
                    <select
                      autoFocus
                      className={inputClass}
                      defaultValue=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return;
                        patch({ tools: [...selectedIds, id] });
                        setToolsPickerOpen(false);
                      }}
                      onBlur={() => setToolsPickerOpen(false)}
                    >
                      <option value="" disabled>
                        Select capability…
                      </option>
                      {unselectedCaps.map((cap) => (
                        <option key={cap.id} value={cap.id}>
                          {cap.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setToolsPickerOpen(true)}
                      className="fs-caption text-text-secondary hover:text-text-primary underline"
                    >
                      + Add tool
                    </button>
                  ))}
              </div>
            </Field>
          );
        })()}

        {import.meta.env.VITE_DEV === "1" && (
          <Field label="Variables">
            <VariablesEditor
              key={flow.id}
              variables={flow.variables}
              onChange={(v) => patch({ variables: v })}
              scope="flow"
            />
          </Field>
        )}

        <Field label="Example transcript">
          <textarea
            className={textareaClass}
            value={flow.example ?? ""}
            onChange={(e) => patch({ example: e.target.value || undefined })}
            placeholder="Plain-text transcript illustrating intended behavior. Optional."
          />
        </Field>

        <CommentsSection anchor={{ kind: "flow", id: flow.id }} />

        <div className="pt-2 border-t border-border-default space-y-2">
          <button
            onClick={() => setScriptsOpen(true)}
            className="w-full rounded-md border border-border-default px-3 py-1.5 fs-label text-text-secondary hover:bg-surface-hover"
          >
            Open scripts sheet
          </button>
          <LoadInSimButton target={{ kind: "flow", flowId: flow.id }} />
          <button
            onClick={() => {
              if (window.confirm(`Delete flow "${flow!.name}"?`)) removeFlow(flow!.id);
            }}
            className="w-full rounded-md border border-state-error-line px-3 py-1.5 fs-label text-state-error-fg hover:bg-state-error-bg"
          >
            Delete flow
          </button>
        </div>
      </div>
      {scriptsOpen && <ScriptsSheet flow={flow} onClose={() => setScriptsOpen(false)} />}
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      {children}
    </div>
  );
}
