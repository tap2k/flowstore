import { useEffect, useMemo, useState } from "react";
import type { Scenario, ScenarioMockBehavior } from "@flowstore/core/schema/files/scenario";
import { useTestsStore } from "@/lib/store/tests";
import { useSpecStore } from "@/lib/store/spec";
import { useSettingsStore } from "@/lib/store/settings";
import { collectDeclaredVariables } from "@flowstore/core/runtime/contextVars";
import { collectMockableCapabilities } from "@flowstore/core/runtime/capabilityMocks";
import { generateScenarioContent } from "@flowstore/core/runtime/scenarioGen";
import { BUILT_IN_MODELS } from "@flowstore/core/files/models";
import { VarsEditor } from "./scenario/VarsEditor";
import { MocksEditor } from "./scenario/MocksEditor";

// Saved scenarios library. Each row expands inline to edit vars + mocks.
// Placeholder-first +New / inline ✨ Generate / per-row Regenerate from
// the row's name + notes.

export function ScenariosPanel() {
  const scenarios = useTestsStore((s) => s.scenarios);
  const saveScenario = useTestsStore((s) => s.saveScenario);
  const deleteScenario = useTestsStore((s) => s.deleteScenario);
  const uniqueScenarioId = useTestsStore((s) => s.uniqueScenarioId);
  const spec = useSpecStore((s) => s.spec);
  const apiKey = useSettingsStore((s) => s.googleApiKey);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState<
    | null
    | { name: string; notes: string; busy: boolean; error: string | null }
  >(null);

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

  function startGenerate() {
    setGenerating({ name: "", notes: "", busy: false, error: null });
  }

  async function runGenerate() {
    if (!generating || !spec || !apiKey) return;
    const name = generating.name.trim();
    const notes = generating.notes.trim();
    if (!name && !notes) return;
    setGenerating({ ...generating, busy: true, error: null });
    try {
      const geminiModel = BUILT_IN_MODELS.default ?? "gemini-2.5-flash";
      const { vars, mocks } = await generateScenarioContent(
        spec,
        apiKey,
        geminiModel,
        { name: name || undefined, notes: notes || undefined },
      );
      const id = uniqueScenarioId(name || "scenario");
      saveScenario({
        $schema: "flowstore://test/scenario/v0",
        id,
        ...(name ? { name } : {}),
        ...(notes ? { notes } : {}),
        ...(Object.keys(vars).length > 0 ? { vars } : {}),
        ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
      });
      setSelectedId(id);
      setGenerating(null);
    } catch (e) {
      setGenerating({
        ...generating,
        busy: false,
        error: e instanceof Error ? e.message : "Generation failed.",
      });
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
        <div className="text-[11px] text-zinc-500">
          {scenarios.length} {scenarios.length === 1 ? "scenario" : "scenarios"}
        </div>
        <div className="flex items-center gap-1">
          {apiKey && spec && (
            <button
              type="button"
              onClick={startGenerate}
              disabled={generating !== null}
              title="Generate a new scenario from a name + notes prompt. Vars and mocks are filled coherently."
              className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              ✨ Generate
            </button>
          )}
          <button
            type="button"
            onClick={startNew}
            title="Create a placeholder scenario — fill vars + mocks inline."
            className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
          >
            + New
          </button>
        </div>
      </div>

      {generating && (
        <div className="space-y-2 border-b border-zinc-200 bg-white px-3 py-2 text-[11px]">
          <div className="font-medium text-zinc-900">Generate scenario</div>
          {generating.error && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
              {generating.error}
            </div>
          )}
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
              name
            </label>
            <input
              type="text"
              autoFocus
              value={generating.name}
              onChange={(e) =>
                setGenerating({ ...generating, name: e.target.value })
              }
              placeholder="e.g. Known caller, policy active"
              className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px]"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
              notes
            </label>
            <textarea
              value={generating.notes}
              onChange={(e) =>
                setGenerating({ ...generating, notes: e.target.value })
              }
              placeholder="What's the world the agent operates in?"
              rows={3}
              className="w-full resize-y rounded border border-zinc-300 bg-white p-1.5 text-[11px] leading-snug"
            />
          </div>
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setGenerating(null)}
              disabled={generating.busy}
              className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={runGenerate}
              disabled={
                generating.busy ||
                (generating.name.trim() === "" && generating.notes.trim() === "")
              }
              className="rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              {generating.busy ? "Generating…" : "Generate"}
            </button>
          </div>
        </div>
      )}

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
                onCopy={() => {
                  const base = sc.name ? `${sc.name} copy` : `${sc.id}-copy`;
                  const newId = uniqueScenarioId(base);
                  saveScenario({
                    ...sc,
                    id: newId,
                    ...(sc.name ? { name: `${sc.name} copy` } : {}),
                  });
                  setSelectedId(newId);
                }}
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
  onSave: (s: Scenario) => void;
  onCopy: () => void;
  onDelete: () => void;
}

function ScenarioRow({ scenario, expanded, onToggle, onSave, onCopy, onDelete }: ScenarioRowProps) {
  const spec = useSpecStore((s) => s.spec);
  const declaredVars = useMemo(() => collectDeclaredVariables(spec), [spec]);
  const mockableCaps = useMemo(() => collectMockableCapabilities(spec), [spec]);

  const [name, setName] = useState(scenario.name ?? "");
  const [notes, setNotes] = useState(scenario.notes ?? "");
  const [vars, setVars] = useState<Record<string, unknown>>(scenario.vars ?? {});
  const [mocks, setMocks] = useState<Record<string, ScenarioMockBehavior>>(
    scenario.mocks ?? {},
  );

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

          <VarsEditor
            declared={declaredVars}
            values={vars}
            onChange={(name, value) => {
              const next = { ...vars };
              if (value === undefined || value === null || value === "") {
                delete next[name];
              } else {
                next[name] = value;
              }
              setVars(next);
            }}
          />

          <MocksEditor
            caps={mockableCaps}
            behaviors={mocks}
            keyOf={(cap) => cap.capabilityId}
            onChange={(k, behavior) => {
              const next = { ...mocks };
              if (behavior === undefined) {
                delete next[k];
              } else {
                next[k] = behavior;
              }
              setMocks(next);
            }}
          />

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onDelete}
              className="rounded border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCopy}
                title="Duplicate this scenario as a new one — handy for variant authoring (e.g. tweak one mock)."
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
              >
                Copy
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
        </div>
      )}
    </li>
  );
}
