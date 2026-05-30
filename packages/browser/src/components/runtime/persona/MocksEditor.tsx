import { useState } from "react";
import type {
  MockableCapability,
} from "@flowstore/core/runtime/capabilityMocks";
import type { MockBehavior } from "@flowstore/core/schema/files/mockBehavior";
import { TypedValueInput } from "../TypedValueInput";

// Collapsible mocks editor. Behavior per capability is the unified
// MockBehavior union — both callers (run-pill PersonaForm and
// PersonasPanel row) normalize their store shape into this at the
// boundary, then pass an onChange that writes back. Editor itself stays
// shape-agnostic.

interface Props {
  caps: MockableCapability[];
  behaviors: Record<string, MockBehavior>;
  disabled?: boolean;
  // Key is whatever stable key the caller uses to identify a cap — name
  // (runtime) or id (persona/case). Editor only reads/writes through this
  // key; the caller decides which dimension it is.
  keyOf: (cap: MockableCapability) => string;
  onChange: (key: string, behavior: MockBehavior | undefined) => void;
}

export function MocksEditor({ caps, behaviors, disabled, keyOf, onChange }: Props) {
  const [open, setOpen] = useState(false);
  if (caps.length === 0) return null;
  const setCount = caps.filter((c) => behaviors[keyOf(c)] !== undefined).length;
  return (
    <div className="rounded border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-zinc-50"
      >
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          mocks ({setCount}/{caps.length} set)
        </span>
        <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-zinc-100 px-2 py-2">
          {caps.map((cap) => {
            const k = keyOf(cap);
            return (
              <CapMockRow
                key={cap.capabilityId}
                cap={cap}
                behavior={behaviors[k]}
                disabled={disabled}
                onChange={(b) => onChange(k, b)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface CapMockRowProps {
  cap: MockableCapability;
  behavior: MockBehavior | undefined;
  disabled?: boolean;
  onChange: (behavior: MockBehavior | undefined) => void;
}

function CapMockRow({ cap, behavior, disabled, onChange }: CapMockRowProps) {
  const [open, setOpen] = useState(false);
  const kind = behavior?.kind ?? "none";
  const filledHere =
    behavior?.kind === "static" && typeof behavior.returns === "object" && behavior.returns !== null
      ? Object.keys(behavior.returns as Record<string, unknown>).filter(
          (k) => (behavior.returns as Record<string, unknown>)[k] !== undefined,
        ).length
      : 0;
  const subtitle =
    kind === "error"
      ? "error"
      : kind === "none"
        ? "—"
        : cap.outputs.length === 0
          ? "side-effect"
          : `${filledHere}/${cap.outputs.length}`;

  return (
    <div className="rounded border border-zinc-200 bg-white">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 flex-col items-start text-left hover:bg-zinc-50 -mx-2 -my-1.5 px-2 py-1.5"
        >
          <span className="truncate font-mono text-[11px] text-zinc-800 max-w-full">
            {cap.capabilityName}
          </span>
          <span className="font-mono text-[10px] text-zinc-500">{subtitle}</span>
        </button>
        <select
          value={kind}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "none") {
              onChange(undefined);
              return;
            }
            if (v === "error") {
              onChange({ kind: "error", error: "" });
              setOpen(true);
              return;
            }
            onChange({ kind: "static", returns: {} });
            setOpen(true);
          }}
          disabled={!!disabled}
          className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-600"
        >
          <option value="none">— none —</option>
          <option value="static">static</option>
          <option value="error">error</option>
        </select>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-zinc-400 hover:text-zinc-900"
          title={open ? "Collapse" : "Expand"}
        >
          {open ? "▾" : "▸"}
        </button>
      </div>
      {open && behavior && (
        <div className="space-y-1.5 border-t border-zinc-100 px-2 py-2">
          {behavior.kind === "error" ? (
            <input
              type="text"
              value={behavior.error}
              onChange={(e) => onChange({ kind: "error", error: e.target.value })}
              disabled={!!disabled}
              placeholder="Error message the LLM sees as the tool result"
              className="w-full rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-900 focus:outline-none focus:ring-1 focus:ring-red-400"
            />
          ) : cap.outputs.length === 0 ? (
            <div className="text-[10px] text-zinc-500 italic">
              Capability has no declared outputs (side-effect only); returns = {`{}`}.
            </div>
          ) : (
            cap.outputs.map((out) => {
              const returnsObj =
                typeof behavior.returns === "object" &&
                behavior.returns !== null &&
                !Array.isArray(behavior.returns)
                  ? (behavior.returns as Record<string, unknown>)
                  : {};
              return (
                <div key={out.name} className="space-y-0.5">
                  <label className="block text-[11px] font-mono text-zinc-700">
                    {out.name}
                    {!out.decl && <span className="ml-1 text-zinc-400">· undeclared</span>}
                  </label>
                  <TypedValueInput
                    decl={out.decl}
                    value={returnsObj[out.name]}
                    disabled={!!disabled}
                    onChange={(v) => {
                      const next = { ...returnsObj };
                      if (v === undefined || v === null || v === "") {
                        delete next[out.name];
                      } else {
                        next[out.name] = v;
                      }
                      onChange({ kind: "static", returns: next });
                    }}
                  />
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
