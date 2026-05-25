import { useSpecStore } from "@/lib/store/spec";
import type { ExitPath, AssignValue, Method } from "@uxflows/core/schema/v0";
import { GOTO_END, GOTO_RETURN, isReturnGoto } from "@uxflows/core/schema/v0";
import { ListEditor } from "./ListEditor";
import { ConditionEditor } from "./ConditionEditor";

const METHODS: Method[] = ["llm", "calculation", "direct"];

const labelClass = "block text-xs font-medium text-zinc-600 mb-1";
const inputClass =
  "w-full rounded border border-zinc-300 px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400";

interface AssignRow {
  variable: string;
  method: Method;
  rawValue: string;
}

function parseRawValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function rowsFromAssigns(assigns: Record<string, AssignValue> | undefined): AssignRow[] {
  if (!assigns) return [];
  return Object.entries(assigns).map(([variable, av]) => ({
    variable,
    method: av.method,
    rawValue: typeof av.value === "string" ? av.value : JSON.stringify(av.value),
  }));
}

function rowsToAssigns(rows: AssignRow[]): Record<string, AssignValue> | undefined {
  const valid = rows.filter((r) => r.variable.trim() !== "");
  if (valid.length === 0) return undefined;
  const out: Record<string, AssignValue> = {};
  for (const r of valid) {
    out[r.variable] = { method: r.method, value: parseRawValue(r.rawValue) };
  }
  return out;
}

export function EdgeInspector() {
  const selection = useSpecStore((s) => s.selection);
  const flow = useSpecStore((s) =>
    selection?.kind === "edge" ? s.spec?.flows.find((f) => f.id === selection.flowId) ?? null : null
  );
  const exitPath = useSpecStore((s) => {
    if (selection?.kind !== "edge" || !s.spec) return null;
    const f = s.spec.flows.find((f) => f.id === selection.flowId);
    return f?.exit_paths.find((xp) => xp.id === selection.exitPathId) ?? null;
  });
  const flows = useSpecStore((s) => s.spec?.flows) ?? [];
  const capabilities = useSpecStore((s) => s.spec?.agent.capabilities) ?? [];
  const updateExitPath = useSpecStore((s) => s.updateExitPath);
  const removeExitPath = useSpecStore((s) => s.removeExitPath);
  const setSelection = useSpecStore((s) => s.setSelection);

  if (!flow || !exitPath) return null;

  function patch(p: Partial<ExitPath>) {
    if (!flow || !exitPath) return;
    updateExitPath(flow.id, exitPath.id, p);
  }

  const assignRows = rowsFromAssigns(exitPath.assigns);

  return (
    <aside className="w-[380px] shrink-0 border-l border-zinc-200 bg-white overflow-y-auto">
      <div className="sticky top-0 bg-white border-b border-zinc-200 px-4 py-3 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Exit path</span>
        <span className="text-xs text-zinc-400 font-mono truncate">{exitPath.id}</span>
        <button
          onClick={() => setSelection(null)}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-900"
        >
          close
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div className="text-[11px] text-zinc-500">
          From <span className="font-medium text-zinc-700">{flow.name}</span>
        </div>

        <Field label="Condition">
          <ConditionEditor
            condition={exitPath.condition}
            onChange={(c) => patch({ condition: c })}
            placeholder="When this exit is taken"
          />
        </Field>

        <Field label="Destination">
          <select
            className={inputClass}
            value={exitPath.goto}
            onChange={(e) => patch({ goto: e.target.value })}
          >
            {flows.filter((f) => f.id !== flow.id).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option disabled>──────────</option>
            <option value={GOTO_END}>End conversation (END)</option>
            <option value={GOTO_RETURN}>Return to caller (RETURN)</option>
          </select>
          {isReturnGoto(exitPath.goto) && (
            <p className="mt-1 text-[11px] text-zinc-500 italic">
              Resumes whichever flow called this one.
            </p>
          )}
        </Field>

        <Field label="Notes">
          <textarea
            className={`${inputClass} resize-y min-h-[60px]`}
            value={exitPath.notes ?? ""}
            onChange={(e) => patch({ notes: e.target.value || undefined })}
            placeholder="Why this branch exists — audit rationale, stakeholder ask, tradeoff."
          />
        </Field>

        <Field label="Assigns">
          <ListEditor<AssignRow>
            items={assignRows}
            onChange={(rows) => patch({ assigns: rowsToAssigns(rows) })}
            newItem={() => ({ variable: "", method: "direct", rawValue: "" })}
            addLabel="add assignment"
            emptyLabel="(no assignments)"
            renderItem={(row, update, remove) => (
              <div className="rounded border border-zinc-200 p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    value={row.variable}
                    onChange={(e) => update({ ...row, variable: e.target.value })}
                    placeholder="variable_name"
                  />
                  <button
                    onClick={remove}
                    className="text-xs text-zinc-400 hover:text-red-600"
                    title="remove"
                  >
                    ×
                  </button>
                </div>
                <div className="flex gap-2">
                  <select
                    className={`${inputClass} w-32`}
                    value={row.method}
                    onChange={(e) => update({ ...row, method: e.target.value as Method })}
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    className={inputClass}
                    value={row.rawValue}
                    onChange={(e) => update({ ...row, rawValue: e.target.value })}
                    placeholder="value (JSON or string)"
                  />
                </div>
              </div>
            )}
          />
        </Field>

        <Field label="Actions">
          <ListEditor<{ capability_id: string }>
            items={exitPath.actions ?? []}
            onChange={(actions) => patch({ actions: actions.length ? actions : undefined })}
            newItem={() => ({ capability_id: "" })}
            addLabel="add action"
            emptyLabel="(no actions)"
            renderItem={(action, update, remove) => (
              <div className="flex items-center gap-2">
                <select
                  className={inputClass}
                  value={action.capability_id}
                  onChange={(e) => update({ capability_id: e.target.value })}
                >
                  <option value="">— select capability —</option>
                  {capabilities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={remove}
                  className="text-xs text-zinc-400 hover:text-red-600"
                  title="remove"
                >
                  ×
                </button>
              </div>
            )}
          />
          {capabilities.length === 0 && (
            <p className="mt-1 text-[10px] text-zinc-400">
              No capabilities defined yet — add them in the agent sidebar.
            </p>
          )}
        </Field>

        <div className="pt-2 border-t border-zinc-200">
          <button
            onClick={() => {
              if (window.confirm("Delete this exit path?")) removeExitPath(flow!.id, exitPath!.id);
            }}
            className="w-full rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            Delete exit path
          </button>
        </div>
      </div>
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
