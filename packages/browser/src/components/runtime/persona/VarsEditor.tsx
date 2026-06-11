import { useState } from "react";
import type { DeclaredVariable } from "@flowstore/core/runtime/contextVars";
import { TypedValueInput } from "../TypedValueInput";

// Collapsible vars editor for a persona/case world. Shape-agnostic of
// where state lives: the caller passes values + an onChange that
// receives one (name, value) at a time. Used in both the run-pill
// PersonaForm (writes to simulate store) and the PersonasPanel inline
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
  // Vars whose agent declaration says provided: true are the session-start
  // payload — the only ones a run ships to the agent. The rest are character
  // sheet: edit-time ground truth the agent must earn through conversation
  // or mocks. Surfacing the split here is what keeps the filtering at
  // session start from reading as vars silently disappearing.
  const providedCount = declared.filter(
    (d) => d.scope === "agent" && d.decl.provided && values[d.name] !== undefined,
  ).length;
  if (declared.length === 0) return null;
  return (
    <div className="rounded border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-zinc-50"
        title="Filled vars marked 'provided' ship to the agent at session start (set in the variables sheet); the rest are character sheet — the agent only learns them from the conversation or a mock return."
      >
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          vars ({filledCount}/{declared.length} filled · {providedCount} provided)
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
                {d.scope === "agent" && d.decl.provided && (
                  <span
                    className="ml-1 rounded bg-emerald-50 px-1 text-[9px] font-sans text-emerald-700"
                    title="provided: the deployment hands this value to the session at start (dialer payload, caller ID) — a run ships it to the agent."
                  >
                    provided at start
                  </span>
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
