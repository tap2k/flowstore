import { useMemo, useState } from "react";
import type { Spec } from "@flowstore/core/schema/v0";
import type { Scenario } from "@flowstore/core/schema/files/scenario";
import { useSimulateStore } from "@/lib/store/simulate";
import { useTestsStore } from "@/lib/store/tests";

// Run-pill section: pick / save / edit the scenario the next run will use.
// Hydrates contextVars + mockReturns + mockErrors from the loaded scenario.
//
// Stub: load/save/save-as/delete row only. Inline vars + mocks editing
// surfaces will be wired in subsequent commits — for now scenarios are
// authored from the Scenarios tab and consumed read-only here.
interface ScenarioFormProps {
  spec: Spec;
  disabled: boolean;
}

export function ScenarioForm({ spec: _spec, disabled }: ScenarioFormProps) {
  const scenarios = useTestsStore((s) => s.scenarios);
  const saveScenario = useTestsStore((s) => s.saveScenario);
  const deleteScenario = useTestsStore((s) => s.deleteScenario);
  const uniqueScenarioId = useTestsStore((s) => s.uniqueScenarioId);
  const setContextVars = useSimulateStore((s) => s.setContextVars);
  const setMockReturns = useSimulateStore((s) => s.setMockReturns);
  const setMockError = useSimulateStore((s) => s.setMockError);

  const [loadedScenarioId, setLoadedScenarioId] = useState<string | null>(null);
  const [savingAsName, setSavingAsName] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const loadedScenario = useMemo(
    () => (loadedScenarioId ? scenarios.find((s) => s.id === loadedScenarioId) ?? null : null),
    [loadedScenarioId, scenarios],
  );

  function onLoadScenario(id: string) {
    if (id === "") return;
    const sc = scenarios.find((s) => s.id === id);
    if (!sc) return;
    setContextVars(sc.vars ?? {});
    // Hydrate per-cap mocks. `static` returns become mockReturns entries
    // keyed by capability NAME (not id) because resolveMockedCall keys on
    // name; `error` becomes mockErrors. Caps not listed clear both.
    const capByIdToName = new Map<string, string>();
    for (const cap of _spec.agent.capabilities ?? []) {
      capByIdToName.set(cap.id, cap.name);
    }
    const nextReturns: Record<string, Record<string, unknown>> = {};
    const nextErrors: Record<string, string> = {};
    for (const [capId, behavior] of Object.entries(sc.mocks ?? {})) {
      const capName = capByIdToName.get(capId);
      if (!capName) continue;
      if (behavior.kind === "error") {
        nextErrors[capName] = behavior.error;
      } else {
        const r = behavior.returns;
        if (typeof r === "object" && r !== null && !Array.isArray(r)) {
          nextReturns[capName] = r as Record<string, unknown>;
        }
      }
    }
    setMockReturns(nextReturns);
    // Wipe any previously-set errors before applying the new set.
    for (const cap of _spec.agent.capabilities ?? []) {
      setMockError(cap.name, null);
    }
    for (const [capName, errMsg] of Object.entries(nextErrors)) {
      setMockError(capName, errMsg);
    }
    setLoadedScenarioId(id);
    setOpen(true);
  }

  function onSaveScenario() {
    if (!loadedScenario) return;
    // Until the inline editor lands, save echoes the current scenario
    // back (no-op upsert). Real edits happen via the Scenarios tab.
    saveScenario(loadedScenario);
  }

  function onStartSaveAs() {
    setSavingAsName(loadedScenario?.name ?? "scenario");
  }
  function onConfirmSaveAs() {
    if (savingAsName === null) return;
    const name = savingAsName.trim();
    if (name === "") return;
    const id = uniqueScenarioId(name);
    saveScenario({
      $schema: "flowstore://test/scenario/v0",
      id,
      name,
    });
    setLoadedScenarioId(id);
    setSavingAsName(null);
  }
  function onCancelSaveAs() {
    setSavingAsName(null);
  }

  function onDeleteScenario() {
    if (!loadedScenario) return;
    const ok = window.confirm(`Delete scenario "${loadedScenario.name || loadedScenario.id}"?`);
    if (!ok) return;
    deleteScenario(loadedScenario.id);
    setLoadedScenarioId(null);
  }

  return (
    <div className="border-b border-zinc-200 bg-zinc-50/50">
      <div className="flex items-center justify-between px-4 py-2 text-[11px] text-zinc-600">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center text-left hover:text-zinc-900"
        >
          <span className="mr-1 text-zinc-400">{open ? "▾" : "▸"}</span>
          Scenario
          <span className="ml-1 text-zinc-400">
            {loadedScenario ? loadedScenario.name || loadedScenario.id : "none"}
          </span>
        </button>
      </div>

      {open && (
        <div className="space-y-2 px-4 pb-3">
          <div className="flex items-center gap-1 text-[10px] text-zinc-600">
            <select
              value={loadedScenarioId ?? ""}
              onChange={(e) => onLoadScenario(e.target.value)}
              disabled={disabled || scenarios.length === 0}
              className="max-w-[8rem] truncate rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              <option value="">
                {scenarios.length === 0 ? "no saved scenarios" : "load saved…"}
              </option>
              {scenarios.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name || sc.id}
                </option>
              ))}
            </select>
            {loadedScenario && (
              <button
                type="button"
                onClick={onSaveScenario}
                disabled={disabled}
                title={`Update tests/scenarios/${loadedScenario.id}.scenario.json.`}
                className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                save
              </button>
            )}
            {savingAsName === null ? (
              <button
                type="button"
                onClick={onStartSaveAs}
                disabled={disabled}
                title="Save current run-pill state as a new scenario."
                className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                save as…
              </button>
            ) : (
              <>
                <input
                  type="text"
                  autoFocus
                  value={savingAsName}
                  onChange={(e) => setSavingAsName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onConfirmSaveAs();
                    else if (e.key === "Escape") onCancelSaveAs();
                  }}
                  placeholder="name"
                  className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] font-mono text-zinc-800"
                  style={{ width: "8rem" }}
                />
                <button
                  type="button"
                  onClick={onCancelSaveAs}
                  className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
                >
                  cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirmSaveAs}
                  disabled={savingAsName.trim() === ""}
                  className="rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
                >
                  save
                </button>
              </>
            )}
            {loadedScenario && (
              <button
                type="button"
                onClick={onDeleteScenario}
                disabled={disabled}
                title={`Delete tests/scenarios/${loadedScenario.id}.scenario.json.`}
                className="rounded border border-red-300 bg-white px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                delete
              </button>
            )}
          </div>
          <p className="text-[10px] text-zinc-500">
            Pick a scenario to hydrate vars + mocks for this run. Edit scenario
            content from the <span className="font-medium">Scenarios</span> tab.
          </p>
        </div>
      )}
    </div>
  );
}

// Helper used by Scenario library view when editing a Scenario inline.
export type { Scenario };
