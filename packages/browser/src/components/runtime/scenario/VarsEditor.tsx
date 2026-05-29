import { useState } from "react";
import type { DeclaredVariable } from "@flowstore/core/runtime/contextVars";
import { TypedValueInput } from "../TypedValueInput";

// Collapsible vars editor for a scenario authoring context. Shape-agnostic
// of where state lives: the caller passes values + an onChange that
// receives one (name, value) at a time. Used in both the run-pill
// ScenarioForm (writes to simulate store) and the ScenariosPanel inline
// row (writes to local row state).

interface Props {
  declared: DeclaredVariable[];
  values: Record<string, unknown>;
  disabled?: boolean;
  onChange: (name: string, value: unknown) => void;
}

export function VarsEditor({ declared, values, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const filledCount = declared.filter((d) => values[d.name] !== undefined).length;
  if (declared.length === 0) return null;
  return (
    <div className="rounded border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-zinc-50"
      >
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          vars ({filledCount}/{declared.length} filled)
        </span>
        <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-zinc-100 px-2 py-2">
          {declared.map((d) => (
            <div key={d.name} className="space-y-0.5">
              <label className="block text-[11px] font-mono text-zinc-700">
                {d.name}
                {d.scope === "flow" && (
                  <span className="ml-1 text-zinc-400">· flow {d.flowId}</span>
                )}
              </label>
              <TypedValueInput
                decl={d.decl}
                value={values[d.name]}
                disabled={!!disabled}
                onChange={(v) => onChange(d.name, v)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
