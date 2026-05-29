import { useEffect, useState } from "react";
import type { Persona } from "@flowstore/core/schema/files/persona";
import { useTestsStore } from "@/lib/store/tests";
import { useSimulateStore } from "@/lib/store/simulate";
import { useUiStore } from "@/lib/store/ui";
import { useSpecStore } from "@/lib/store/spec";
import { useSettingsStore } from "@/lib/store/settings";
import { generatePersonaPrompt } from "@flowstore/core/runtime/personaGen";
import { GENERATION_MODEL } from "@flowstore/core/files/models";

// Saved-persona library for the Run pill's Personas tab. Compact vertical
// list, click a row to expand its editor inline. Personas are
// file-backed (tests/personas/<id>.persona.json); save / delete mark the
// project dirty and ride on the next GitHub Save. The Simulate-tab
// PersonaForm (a separate component) edits the in-memory `personaPrompt`
// buffer; this panel manages the persisted records.

export function PersonasPanel() {
  const personas = useTestsStore((s) => s.personas);
  const savePersona = useTestsStore((s) => s.savePersona);
  const deletePersona = useTestsStore((s) => s.deletePersona);
  const uniquePersonaId = useTestsStore((s) => s.uniquePersonaId);
  const setPersonaPrompt = useSimulateStore((s) => s.setPersonaPrompt);
  const setActiveCaseId = useSimulateStore((s) => s.setActiveCaseId);
  const setOpenSimulateTab = useUiStore((s) => s.setOpenSimulateTab);
  const spec = useSpecStore((s) => s.spec);
  const apiKey = useSettingsStore((s) => s.googleApiKey);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState<
    | null
    | { name: string; notes: string; busy: boolean; error: string | null }
  >(null);

  function startNew() {
    const defaultName = `Persona ${personas.length + 1}`;
    const id = uniquePersonaId(defaultName);
    savePersona({
      $schema: "flowstore://test/persona/v0",
      id,
      system_prompt: "",
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
      const systemPrompt = await generatePersonaPrompt({
        spec,
        contextVars: {},
        apiKey,
        model: GENERATION_MODEL,
        personaContext: { name: name || undefined, notes: notes || undefined },
      });
      const id = uniquePersonaId(name || "persona");
      savePersona({
        $schema: "flowstore://test/persona/v0",
        id,
        ...(name ? { name } : {}),
        ...(notes ? { notes } : {}),
        system_prompt: systemPrompt,
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

  function useInSimulate(p: Persona) {
    setPersonaPrompt(p.system_prompt);
    // Picking a persona = starting a free exploration. Drop any
    // active-case binding so the Active-case strip and verdict surfaces
    // don't linger and conflict with what's actually being run.
    setActiveCaseId(null);
    setOpenSimulateTab("simulate");
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
        <div className="text-[11px] text-zinc-500">
          {personas.length} {personas.length === 1 ? "persona" : "personas"}
        </div>
        <div className="flex items-center gap-1">
          {apiKey && spec && (
            <button
              type="button"
              onClick={startGenerate}
              disabled={generating !== null}
              title="Generate a new persona from a name + notes prompt."
              className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              ✨ Generate
            </button>
          )}
          <button
            type="button"
            onClick={startNew}
            title="Create a placeholder persona — fill prompt inline."
            className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
          >
            + New
          </button>
        </div>
      </div>

      {generating && (
        <div className="space-y-2 border-b border-zinc-200 bg-white px-3 py-2 text-[11px]">
          <div className="font-medium text-zinc-900">Generate persona</div>
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
              placeholder="e.g. Polite first-time caller"
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
              placeholder="Who is this user, why are they calling, what's their style?"
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
        {personas.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-500">
            No saved personas yet. Click <span className="font-medium">+ New</span> to add one,
            or save the current Simulate-tab persona via the PersonaForm.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {personas.map((p) => (
              <PersonaRow
                key={p.id}
                persona={p}
                expanded={selectedId === p.id}
                onToggle={() => setSelectedId(selectedId === p.id ? null : p.id)}
                onSave={(updated) => savePersona(updated)}
                onCopy={() => {
                  const base = p.name ? `${p.name} copy` : `${p.id}-copy`;
                  const newId = uniquePersonaId(base);
                  savePersona({
                    ...p,
                    id: newId,
                    ...(p.name ? { name: `${p.name} copy` } : {}),
                  });
                  setSelectedId(newId);
                }}
                onDelete={() => {
                  const ok = window.confirm(`Delete persona "${p.name || p.id}"?`);
                  if (!ok) return;
                  deletePersona(p.id);
                  if (selectedId === p.id) setSelectedId(null);
                }}
                onUseInSimulate={() => useInSimulate(p)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface PersonaRowProps {
  persona: Persona;
  expanded: boolean;
  onToggle: () => void;
  onSave: (p: Persona) => void;
  onCopy: () => void;
  onDelete: () => void;
  onUseInSimulate: () => void;
}

function PersonaRow({
  persona,
  expanded,
  onToggle,
  onSave,
  onCopy,
  onDelete,
  onUseInSimulate,
}: PersonaRowProps) {
  // Local draft so edits can be cancelled by collapsing without saving. On
  // expand, hydrate from the saved record. On Save, push to the store.
  const [name, setName] = useState(persona.name ?? "");
  const [notes, setNotes] = useState(persona.notes ?? "");
  const [systemPrompt, setSystemPrompt] = useState(persona.system_prompt);
  const [defaultScenarioId, setDefaultScenarioId] = useState(
    persona.default_scenario_id ?? "",
  );
  const scenarios = useTestsStore((s) => s.scenarios);

  useEffect(() => {
    if (expanded) {
      setName(persona.name ?? "");
      setNotes(persona.notes ?? "");
      setSystemPrompt(persona.system_prompt);
      setDefaultScenarioId(persona.default_scenario_id ?? "");
    }
  }, [expanded, persona]);

  const dirty =
    name !== (persona.name ?? "") ||
    notes !== (persona.notes ?? "") ||
    systemPrompt !== persona.system_prompt ||
    defaultScenarioId !== (persona.default_scenario_id ?? "");

  function handleSave() {
    const updated: Persona = {
      $schema: "flowstore://test/persona/v0",
      id: persona.id,
      system_prompt: systemPrompt,
      // Preserve optional fields the editor doesn't surface (model).
      ...(persona.model !== undefined ? { model: persona.model } : {}),
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(defaultScenarioId ? { default_scenario_id: defaultScenarioId } : {}),
    };
    onSave(updated);
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
            {persona.name || persona.id}
          </div>
          <div className="truncate font-mono text-[10px] text-zinc-500">{persona.id}</div>
        </div>
        <span className="ml-2 text-zinc-400">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-zinc-100 bg-zinc-50/50 px-3 py-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
              name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Human-readable label"
              className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
              notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What does this persona test?"
              className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
              system_prompt
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={10}
              placeholder="System prompt for the persona playing the user."
              className="w-full resize-y rounded border border-zinc-300 bg-white p-2 font-mono text-[11px] leading-snug text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
              default scenario
            </label>
            <select
              value={defaultScenarioId}
              onChange={(e) => setDefaultScenarioId(e.target.value)}
              title="Optional. When this persona is loaded in Simulate, its world (vars + mocks) hydrates from this scenario."
              className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700"
            >
              <option value="">— none —</option>
              {scenarios.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name || sc.id}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onDelete}
              title="Delete this persona"
              className="rounded border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCopy}
                title="Duplicate this persona as a new one — handy for variant authoring."
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={onUseInSimulate}
                title="Load this persona's system_prompt into the Simulate tab buffer."
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
              >
                Use in Simulate
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
