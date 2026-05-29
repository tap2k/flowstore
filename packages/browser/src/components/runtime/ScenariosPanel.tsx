import { useState } from "react";
import type { Scenario } from "@flowstore/core/schema/files/scenario";
import { useTestsStore } from "@/lib/store/tests";

// Saved scenarios library — the "World" tab's content. List of scenarios
// (name + id), click to expand. Vars + mocks editing inline.
//
// Stub: rows + create/delete. Inline vars + mocks editing surfaces will
// land in subsequent commits.
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
          title="Create a new scenario (placeholder-first; fill vars + mocks inline)."
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
                onDelete={() => {
                  const ok = window.confirm(
                    `Delete scenario "${sc.name || sc.id}"? Cases binding this scenario will lose the binding.`,
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
  onDelete: () => void;
}

function ScenarioRow({ scenario, expanded, onToggle, onDelete }: ScenarioRowProps) {
  const varsCount = scenario.vars ? Object.keys(scenario.vars).length : 0;
  const mocksCount = scenario.mocks ? Object.keys(scenario.mocks).length : 0;

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
        <div className="space-y-2 border-t border-zinc-100 bg-zinc-50/50 px-3 py-2 text-[11px]">
          {scenario.notes && (
            <div className="text-zinc-600">{scenario.notes}</div>
          )}
          <div className="text-[10px] text-zinc-500">
            Inline vars + mocks editor coming next. For now scenarios are
            authored as JSON files under <code>tests/scenarios/</code>.
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onDelete}
              className="rounded border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
