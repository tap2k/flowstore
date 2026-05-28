import { useMemo, useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import type { Flow, FlowType, Guardrail, Condition } from "@flowstore/core/schema/v0";
import { defaultLanguage } from "@flowstore/core/schema/v0";
import { genId } from "@flowstore/core/ids";
import { ListEditor } from "./ListEditor";
import { FaqListEditor } from "./FaqListEditor";
import { VariablesEditor } from "./VariablesEditor";
import { ConditionEditor } from "./ConditionEditor";
import { ScriptsSheet } from "@/components/sheets/ScriptsSheet";
import { CommentsSection } from "./CommentsSection";

const FLOW_TYPES: FlowType[] = ["happy", "sad", "off", "utility", "interrupt"];

const labelClass = "block text-xs font-medium text-zinc-600 mb-1";
const inputClass =
  "w-full rounded border border-zinc-300 px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400";
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
  const updateFlow = useSpecStore((s) => s.updateFlow);
  const removeFlow = useSpecStore((s) => s.removeFlow);
  const setSelection = useSpecStore((s) => s.setSelection);
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [retrievalPickerOpen, setRetrievalPickerOpen] = useState(false);

  if (!flow) return null;

  const defaultLang = defaultLanguage(languages);

  function patch(p: Partial<Flow>) {
    if (!flow) return;
    updateFlow(flow.id, p);
  }

  const isInterrupt = flow.type === "interrupt";

  return (
    <aside className="w-[380px] shrink-0 border-l border-zinc-200 bg-white overflow-y-auto">
      <div className="sticky top-0 bg-white border-b border-zinc-200 px-4 py-3 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Flow</span>
        <span className="text-xs text-zinc-400 font-mono truncate">{flow.id}</span>
        <button
          onClick={() => setSelection(null)}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-900"
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
                    className="text-xs text-zinc-400 hover:text-red-600 mt-1"
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

        {retrievalCaps.length > 0 && (() => {
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
                  <div className="text-xs text-zinc-400 italic">(none)</div>
                )}
                {selectedCaps.map((cap) => (
                  <div
                    key={cap.id}
                    className="flex items-start gap-2 rounded border border-zinc-200 px-2 py-1.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-zinc-900 truncate">{cap.name}</div>
                      {cap.description && (
                        <div className="text-zinc-500 mt-0.5">{cap.description}</div>
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
                      className="text-zinc-400 hover:text-red-600 leading-none"
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
                      className="text-xs text-zinc-600 hover:text-zinc-900 underline"
                    >
                      + Add retrieval
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

        <div className="pt-2 border-t border-zinc-200 space-y-2">
          <button
            onClick={() => setScriptsOpen(true)}
            className="w-full rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Open scripts sheet
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Delete flow "${flow!.name}"?`)) removeFlow(flow!.id);
            }}
            className="w-full rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
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
