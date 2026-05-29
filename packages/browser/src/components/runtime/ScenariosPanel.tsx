import { useEffect, useMemo, useState } from "react";
import type { Scenario, ScenarioMockBehavior } from "@flowstore/core/schema/files/scenario";
import { useTestsStore } from "@/lib/store/tests";
import { useSpecStore } from "@/lib/store/spec";
import {
  collectDeclaredVariables,
  type DeclaredVariable,
} from "@flowstore/core/runtime/contextVars";
import {
  collectMockableCapabilities,
  type MockableCapability,
} from "@flowstore/core/runtime/capabilityMocks";
import { TypedValueInput } from "./TypedValueInput";

// Saved scenarios library. Each row expands inline to edit the scenario's
// vars (free-form key/value, declared against agent.variables) and mocks
// (per-capability static returns or error). Same row pattern as personas
// and golds — placeholder-first creation; Delete | Save at the bottom of
// the expanded body.

export function ScenariosPanel() {
  const scenarios = useTestsStore((s) => s.scenarios);
  const saveScenario = useTestsStore((s) => s.saveScenario);
  const deleteScenario = useTestsStore((s) => s.deleteScenario);
  const uniqueScenarioId = useTestsStore((s) => s.uniqueScenarioId);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  function startNew() {
    const defaultName = `Scenario ${scenarios.length + 1}`;
    const id = uniqueScenarioId(defaultName);
    saveScenario({
      $schema: "flowstore://test/scenario/v0",
      id,
      name: defaultName,
    });
    setSelectedId(id);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
        <div className="text-[11px] text-zinc-500">
          {scenarios.length} {scenarios.length === 1 ? "scenario" : "scenarios"}
        </div>
        <button
          type="button"
          onClick={startNew}
          title="Create a placeholder scenario — fill vars + mocks inline."
          className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {scenarios.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-500">
            No scenarios yet. Click <span className="font-medium">+ New</span> to add one.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {scenarios.map((sc) => (
              <ScenarioRow
                key={sc.id}
                scenario={sc}
                expanded={selectedId === sc.id}
                onToggle={() => setSelectedId(selectedId === sc.id ? null : sc.id)}
                onSave={(updated) => saveScenario(updated)}
                onDelete={() => {
                  const ok = window.confirm(
                    `Delete scenario "${sc.name || sc.id}"? Cases binding it will lose the binding.`,
                  );
                  if (!ok) return;
                  deleteScenario(sc.id);
                  if (selectedId === sc.id) setSelectedId(null);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ScenarioRowProps {
  scenario: Scenario;
  expanded: boolean;
  onToggle: () => void;
  onSave: (s: Scenario) => void;
  onDelete: () => void;
}

function ScenarioRow({ scenario, expanded, onToggle, onSave, onDelete }: ScenarioRowProps) {
  const spec = useSpecStore((s) => s.spec);
  const declaredVars = useMemo(() => collectDeclaredVariables(spec), [spec]);
  const mockableCaps = useMemo(() => collectMockableCapabilities(spec), [spec]);

  const [name, setName] = useState(scenario.name ?? "");
  const [notes, setNotes] = useState(scenario.notes ?? "");
  const [vars, setVars] = useState<Record<string, unknown>>(scenario.vars ?? {});
  const [mocks, setMocks] = useState<Record<string, ScenarioMockBehavior>>(scenario.mocks ?? {});

  useEffect(() => {
    if (expanded) {
      setName(scenario.name ?? "");
      setNotes(scenario.notes ?? "");
      setVars(scenario.vars ?? {});
      setMocks(scenario.mocks ?? {});
    }
  }, [expanded, scenario]);

  const varsCount = Object.keys(vars).length;
  const mocksCount = Object.keys(mocks).length;

  const dirty =
    name !== (scenario.name ?? "") ||
    notes !== (scenario.notes ?? "") ||
    JSON.stringify(vars) !== JSON.stringify(scenario.vars ?? {}) ||
    JSON.stringify(mocks) !== JSON.stringify(scenario.mocks ?? {});

  function handleSave() {
    const next: Scenario = {
      $schema: "flowstore://test/scenario/v0",
      id: scenario.id,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(Object.keys(vars).length > 0 ? { vars } : {}),
      ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
    };
    onSave(next);
  }

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-zinc-900">
            {scenario.name || scenario.id}
          </div>
          <div className="truncate font-mono text-[10px] text-zinc-500">
            {scenario.id} | {varsCount} vars · {mocksCount} mocks
          </div>
        </div>
        <span className="ml-2 text-zinc-400">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-zinc-100 bg-zinc-50/50 px-3 py-2 text-[11px]">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
              name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Human-readable label"
              className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px]"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
              notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What does this scenario test?"
              rows={2}
              className="w-full resize-y rounded border border-zinc-300 bg-white p-1.5 text-[11px] leading-snug"
            />
          </div>

          <VarsEditor declared={declaredVars} values={vars} onChange={setVars} />

          <MocksEditor caps={mockableCaps} mocks={mocks} onChange={setMocks} />

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onDelete}
              className="rounded border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty}
              title={dirty ? "Save changes" : "No unsaved edits"}
              className="rounded-md bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

// ---- Vars editor ----

interface VarsEditorProps {
  declared: DeclaredVariable[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

function VarsEditor({ declared, values, onChange }: VarsEditorProps) {
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
                disabled={false}
                onChange={(v) => {
                  const next = { ...values };
                  if (v === undefined || v === null || v === "") {
                    delete next[d.name];
                  } else {
                    next[d.name] = v;
                  }
                  onChange(next);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Mocks editor ----

interface MocksEditorProps {
  caps: MockableCapability[];
  mocks: Record<string, ScenarioMockBehavior>;
  onChange: (next: Record<string, ScenarioMockBehavior>) => void;
}

function MocksEditor({ caps, mocks, onChange }: MocksEditorProps) {
  const [open, setOpen] = useState(false);

  if (caps.length === 0) return null;

  return (
    <div className="rounded border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-zinc-50"
      >
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          mocks ({Object.keys(mocks).length}/{caps.length} set)
        </span>
        <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-zinc-100 px-2 py-2">
          {caps.map((cap) => (
            <CapMockRow
              key={cap.capabilityId}
              cap={cap}
              behavior={mocks[cap.capabilityId]}
              onChange={(b) => {
                const next = { ...mocks };
                if (b === undefined) {
                  delete next[cap.capabilityId];
                } else {
                  next[cap.capabilityId] = b;
                }
                onChange(next);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CapMockRowProps {
  cap: MockableCapability;
  behavior: ScenarioMockBehavior | undefined;
  onChange: (next: ScenarioMockBehavior | undefined) => void;
}

function CapMockRow({ cap, behavior, onChange }: CapMockRowProps) {
  const [open, setOpen] = useState(false);
  const kind = behavior?.kind ?? "none";

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
          <span className="font-mono text-[10px] text-zinc-500">{kind}</span>
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
            } else {
              onChange({ kind: "static", returns: {} });
            }
            setOpen(true);
          }}
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
              placeholder="Error message the LLM sees as the tool result"
              className="w-full rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-900 focus:outline-none focus:ring-1 focus:ring-red-400"
            />
          ) : (
            <StaticReturnsEditor
              cap={cap}
              returns={
                typeof behavior.returns === "object" &&
                behavior.returns !== null &&
                !Array.isArray(behavior.returns)
                  ? (behavior.returns as Record<string, unknown>)
                  : {}
              }
              onChange={(r) => onChange({ kind: "static", returns: r })}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface StaticReturnsEditorProps {
  cap: MockableCapability;
  returns: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

function StaticReturnsEditor({ cap, returns, onChange }: StaticReturnsEditorProps) {
  if (cap.outputs.length === 0) {
    return (
      <div className="text-[10px] text-zinc-500 italic">
        Capability has no declared outputs (side-effect only); returns = {`{}`}.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {cap.outputs.map((out) => (
        <div key={out.name} className="space-y-0.5">
          <label className="block text-[11px] font-mono text-zinc-700">
            {out.name}
            {!out.decl && <span className="ml-1 text-zinc-400">· undeclared</span>}
          </label>
          <TypedValueInput
            decl={out.decl}
            value={returns[out.name]}
            disabled={false}
            onChange={(v) => {
              const next = { ...returns };
              if (v === undefined || v === null || v === "") {
                delete next[out.name];
              } else {
                next[out.name] = v;
              }
              onChange(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}
