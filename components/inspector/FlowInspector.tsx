import { useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import type { Flow, FlowType, Guardrail, FaqEntry, Condition } from "@/lib/schema/v0";
import { genId } from "@/lib/ids";
import { ListEditor } from "./ListEditor";
import { FlowPicker } from "./FlowPicker";
import { VariablesEditor } from "./VariablesEditor";
import { ConditionEditor } from "./ConditionEditor";
import { ScriptsSheet } from "@/components/sheets/ScriptsSheet";

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
  const updateFlow = useSpecStore((s) => s.updateFlow);
  const removeFlow = useSpecStore((s) => s.removeFlow);
  const setSelection = useSpecStore((s) => s.setSelection);
  const [scriptsOpen, setScriptsOpen] = useState(false);

  if (!flow) return null;

  function patch(p: Partial<Flow>) {
    if (!flow) return;
    updateFlow(flow.id, p);
  }

  const isInterrupt = flow.type === "interrupt";
  const scope = flow.scope ?? [];
  const isGlobal = scope.length === 1 && scope[0] === "global";

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

        <Field label="Description">
          <textarea
            className={`${inputClass} resize-y min-h-[60px]`}
            value={flow.description ?? ""}
            onChange={(e) => patch({ description: e.target.value || undefined })}
          />
        </Field>

        <Field label="Type">
          <select
            className={inputClass}
            value={flow.type}
            onChange={(e) => {
              const next = e.target.value as FlowType;
              patch({ type: next, scope: next === "interrupt" ? flow.scope ?? ["global"] : undefined });
            }}
          >
            {FLOW_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        {isInterrupt && (
          <Field label="Scope">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  checked={isGlobal}
                  onChange={() => patch({ scope: ["global"] })}
                />
                Global
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  checked={!isGlobal}
                  onChange={() => patch({ scope: [] })}
                />
                Scoped to specific flows
              </label>
              {!isGlobal && (
                <FlowPicker
                  selected={scope}
                  onChange={(next) => patch({ scope: next })}
                  excludeId={flow.id}
                />
              )}
            </div>
          </Field>
        )}

        {isInterrupt && (
          <Field label="Entry condition">
            <ConditionEditor
              condition={flow.routing.entry_condition}
              onChange={(c: Condition | undefined) =>
                patch({ routing: { ...flow.routing, entry_condition: c } })
              }
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

        <Field label="Max turns">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={flow.max_turns ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              patch({ max_turns: v === "" ? undefined : Number(v) });
            }}
            placeholder="(optional)"
          />
        </Field>

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

        <Field label="Knowledge — FAQ">
          <ListEditor<FaqEntry>
            items={flow.knowledge?.faq ?? []}
            onChange={(faq) =>
              patch({ knowledge: faq.length ? { faq } : undefined })
            }
            newItem={() => ({ question: "", answer: "" })}
            addLabel="add FAQ entry"
            emptyLabel="(none)"
            renderItem={(entry, update, remove) => (
              <div className="rounded border border-zinc-200 p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    value={entry.question}
                    onChange={(e) => update({ ...entry, question: e.target.value })}
                    placeholder="Question"
                  />
                  <button
                    onClick={remove}
                    className="text-xs text-zinc-400 hover:text-red-600"
                    title="remove"
                  >
                    ×
                  </button>
                </div>
                <textarea
                  className={`${inputClass} resize-y min-h-[50px]`}
                  value={entry.answer}
                  onChange={(e) => update({ ...entry, answer: e.target.value })}
                  placeholder="Answer"
                />
              </div>
            )}
          />
        </Field>

        <Field label="Variables">
          <VariablesEditor
            key={flow.id}
            variables={flow.variables}
            onChange={(v) => patch({ variables: v })}
          />
        </Field>

        <Field label="Example transcript">
          <textarea
            className={textareaClass}
            value={flow.example ?? ""}
            onChange={(e) => patch({ example: e.target.value || undefined })}
            placeholder="Plain-text transcript illustrating intended behavior. Optional."
          />
        </Field>

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
