import { useState } from "react";
import type { VariableDecl, VariableType } from "@flowstore/core/schema/v0";
import { useSettingsStore } from "@/lib/store/settings";

const VARIABLE_TYPES: VariableType[] = ["string", "number", "boolean", "enum"];

const inputClass =
  "w-full rounded border border-border-default px-2 py-1 fs-caption bg-surface-panel focus:outline-none focus:ring-1 focus:ring-focus-ring";

interface Row {
  name: string;
  type: VariableType | "";
  description: string;
  values: string;
  visibleWhen: string;
  provided: boolean;
}

interface VariablesEditorProps {
  variables: Record<string, VariableDecl> | undefined;
  onChange: (next: Record<string, VariableDecl> | undefined) => void;
  // provided (session-start payload) is an agent-level concept — flow vars
  // arise mid-conversation, so the checkbox is hidden there and the key is
  // dropped on edit (graphRules warns about it anyway).
  scope: "agent" | "flow";
}

function rowsFrom(variables: Record<string, VariableDecl> | undefined): Row[] {
  if (!variables) return [];
  return Object.entries(variables).map(([name, decl]) => ({
    name,
    type: decl.type ?? "",
    description: decl.description ?? "",
    values: decl.values?.join(", ") ?? "",
    visibleWhen: decl.visible_when ?? "",
    provided: decl.provided ?? false,
  }));
}

function rowsTo(rows: Row[], scope: "agent" | "flow"): Record<string, VariableDecl> | undefined {
  const valid = rows.filter((r) => r.name.trim() !== "");
  if (valid.length === 0) return undefined;
  const out: Record<string, VariableDecl> = {};
  for (const r of valid) {
    const decl: VariableDecl = {};
    if (r.type) decl.type = r.type;
    if (r.description.trim()) decl.description = r.description.trim();
    if (r.type === "enum") {
      const parsed = r.values.split(",").map((s) => s.trim()).filter(Boolean);
      if (parsed.length > 0) decl.values = parsed;
    }
    if (r.visibleWhen.trim()) decl.visible_when = r.visibleWhen.trim();
    // Written only when true so unchecked rows round-trip to a clean decl.
    if (scope === "agent" && r.provided) decl.provided = true;
    out[r.name.trim()] = decl;
  }
  return out;
}

const labelClass = "mb-0.5 block fs-micro text-text-tertiary";

export function VariablesEditor({ variables, onChange, scope }: VariablesEditorProps) {
  // Local state holds draft rows (including unnamed ones); only named rows are committed to spec.
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(variables));
  const runnerUrl = useSettingsStore((s) => s.runnerUrl);
  // visible_when is enforced only by the Python runner's supervisor — prompt
  // mode bakes values into the static prompt ungated — so only surface it
  // when a runner is plausibly in play (mirrors the SettingsSheet gate), or
  // when a declaration already carries one: an imported spec must never hold
  // behavior the author can't see or remove.
  const showVisibleWhen =
    import.meta.env.VITE_DEV === "1" ||
    runnerUrl !== "" ||
    rows.some((r) => r.visibleWhen !== "");

  function commit(next: Row[]) {
    setRows(next);
    onChange(rowsTo(next, scope));
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <div className="fs-caption text-text-tertiary italic">
          Variables are created by reference. Declare here to attach a type.
        </div>
      )}
      {rows.map((row, i) => (
        <div key={i} className="rounded border border-border-default p-2 space-y-1.5">
          <div className="flex items-end gap-2">
            <label className="block flex-1">
              <span className={labelClass}>Name</span>
              <input
                className={inputClass}
                value={row.name}
                onChange={(e) =>
                  commit(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                }
                placeholder="variable_name"
              />
            </label>
            <label className="block w-28">
              <span className={labelClass}>Type</span>
              <select
                className={inputClass}
                value={row.type}
                onChange={(e) =>
                  commit(
                    rows.map((r, j) =>
                      j === i ? { ...r, type: e.target.value as VariableType | "" } : r
                    )
                  )
                }
              >
                <option value="">—</option>
                {VARIABLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => commit(rows.filter((_, j) => j !== i))}
              className="pb-1.5 fs-caption text-text-tertiary hover:text-state-error-fg"
              title="remove"
            >
              ×
            </button>
          </div>
          <label className="block">
            <span className={labelClass}>Description</span>
            <input
              className={inputClass}
              value={row.description}
              onChange={(e) =>
                commit(rows.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))
              }
              placeholder="optional"
            />
          </label>
          {row.type === "enum" && (
            <label className="block">
              <span className={labelClass}>Allowed values, comma-separated</span>
              <input
                className={inputClass}
                value={row.values}
                onChange={(e) =>
                  commit(rows.map((r, j) => (j === i ? { ...r, values: e.target.value } : r)))
                }
                placeholder="small, medium, large"
              />
            </label>
          )}
          {(scope === "agent" || showVisibleWhen) && (
            <div className="flex items-center gap-2">
              {scope === "agent" && (
                <label
                  className="flex shrink-0 items-center gap-1 fs-caption text-text-secondary"
                  title="The deployment hands this value to the agent when the session starts (caller ID, account number). Other variables are filled during the conversation or by capability returns. In a run, the value comes from the persona or test case."
                >
                  <input
                    type="checkbox"
                    checked={row.provided}
                    onChange={(e) =>
                      commit(
                        rows.map((r, j) => (j === i ? { ...r, provided: e.target.checked } : r))
                      )
                    }
                  />
                  provided at start (e.g. caller ID)
                </label>
              )}
              {showVisibleWhen && (
                <input
                  className={inputClass}
                  value={row.visibleWhen}
                  onChange={(e) =>
                    commit(
                      rows.map((r, j) => (j === i ? { ...r, visibleWhen: e.target.value } : r))
                    )
                  }
                  placeholder='visible_when: e.g. identity_confirmed and consent == "full"'
                  title="Data gate: value is withheld from the prompt until this expression is true. Same grammar as exit-path conditions (== != > < and/or/not over variables and literals). Runner-enforced only — prompt mode cannot gate per turn."
                />
              )}
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          commit([
            ...rows,
            {
              name: "",
              type: "string",
              description: "",
              values: "",
              visibleWhen: "",
              provided: false,
            },
          ])
        }
        className="fs-caption text-text-secondary hover:text-text-primary underline"
      >
        + add variable
      </button>
    </div>
  );
}
