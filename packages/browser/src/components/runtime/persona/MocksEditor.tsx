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
    <div className="rounded border border-border-default bg-surface-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-surface-hover"
      >
        <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
          mocks ({setCount}/{caps.length} set)
        </span>
        <span className="text-text-tertiary">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border-subtle px-2 py-2">
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
    <div className="rounded border border-border-default bg-surface-panel">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 flex-col items-start text-left hover:bg-surface-hover -mx-2 -my-1.5 px-2 py-1.5"
        >
          <span className="truncate font-mono text-[11px] text-text-primary max-w-full">
            {cap.capabilityName}
          </span>
          <span className="font-mono text-[10px] text-text-tertiary">{subtitle}</span>
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
          className="rounded border border-border-default bg-surface-panel px-1.5 py-0.5 text-[10px] text-text-secondary"
        >
          <option value="none">— none —</option>
          <option value="static">static</option>
          <option value="error">error</option>
        </select>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-text-tertiary hover:text-text-primary"
          title={open ? "Collapse" : "Expand"}
        >
          {open ? "▾" : "▸"}
        </button>
      </div>
      {open && behavior && (
        <div className="space-y-1.5 border-t border-border-subtle px-2 py-2">
          {behavior.kind === "error" ? (
            <input
              type="text"
              value={behavior.error}
              onChange={(e) => onChange({ kind: "error", error: e.target.value })}
              disabled={!!disabled}
              placeholder="Error message the LLM sees as the tool result"
              className="w-full rounded border border-state-error-line bg-state-error-bg px-2 py-1 text-[11px] text-state-error-fg focus:outline-none focus:ring-1 focus:ring-state-error-line"
            />
          ) : cap.outputs.length === 0 ? (
            <div className="text-[10px] text-text-tertiary italic">
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
                  <label className="block text-[11px] font-mono text-text-secondary">
                    {out.name}
                    {!out.decl && <span className="ml-1 text-text-tertiary">· undeclared</span>}
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
