import { useState } from "react";
import type { VariableDecl, VariableType } from "@flowstore/core/schema/v0";

const VARIABLE_TYPES: VariableType[] = ["string", "number", "boolean", "enum"];

const inputClass =
  "w-full rounded border border-zinc-300 px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400";

interface Row {
  name: string;
  type: VariableType | "";
  description: string;
  values: string;
  visibleWhen: string;
}

interface VariablesEditorProps {
  variables: Record<string, VariableDecl> | undefined;
  onChange: (next: Record<string, VariableDecl> | undefined) => void;
}

function rowsFrom(variables: Record<string, VariableDecl> | undefined): Row[] {
  if (!variables) return [];
  return Object.entries(variables).map(([name, decl]) => ({
    name,
    type: decl.type ?? "",
    description: decl.description ?? "",
    values: decl.values?.join(", ") ?? "",
    visibleWhen: decl.visible_when ?? "",
  }));
}

function rowsTo(rows: Row[]): Record<string, VariableDecl> | undefined {
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
    out[r.name.trim()] = decl;
  }
  return out;
}

export function VariablesEditor({ variables, onChange }: VariablesEditorProps) {
  // Local state holds draft rows (including unnamed ones); only named rows are committed to spec.
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(variables));

  function commit(next: Row[]) {
    setRows(next);
    onChange(rowsTo(next));
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <div className="text-xs text-zinc-400 italic">
          Variables are created by reference. Declare here to attach a type.
        </div>
      )}
      {rows.map((row, i) => (
        <div key={i} className="rounded border border-zinc-200 p-2 space-y-1.5">
          <div className="flex gap-2">
            <input
              className={inputClass}
              value={row.name}
              onChange={(e) =>
                commit(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
              }
              placeholder="variable_name"
            />
            <select
              className={`${inputClass} w-28`}
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
            <button
              onClick={() => commit(rows.filter((_, j) => j !== i))}
              className="text-xs text-zinc-400 hover:text-red-600"
              title="remove"
            >
              ×
            </button>
          </div>
          <input
            className={inputClass}
            value={row.description}
            onChange={(e) =>
              commit(rows.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))
            }
            placeholder="description (optional)"
          />
          {row.type === "enum" && (
            <input
              className={inputClass}
              value={row.values}
              onChange={(e) =>
                commit(rows.map((r, j) => (j === i ? { ...r, values: e.target.value } : r)))
              }
              placeholder="values: foo, bar, baz"
            />
          )}
          {import.meta.env.VITE_DEV === "1" && (
            <input
              className={inputClass}
              value={row.visibleWhen}
              onChange={(e) =>
                commit(
                  rows.map((r, j) => (j === i ? { ...r, visibleWhen: e.target.value } : r))
                )
              }
              placeholder='visible_when: e.g. identity_confirmed and consent == "full"'
              title="Data gate: value is withheld from the prompt until this expression is true. Same grammar as exit-path conditions (== != > < and/or/not over variables and literals)."
            />
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          commit([
            ...rows,
            { name: "", type: "string", description: "", values: "", visibleWhen: "" },
          ])
        }
        className="text-xs text-zinc-600 hover:text-zinc-900 underline"
      >
        + add variable
      </button>
    </div>
  );
}
