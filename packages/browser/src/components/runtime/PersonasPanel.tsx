import { useEffect, useState } from "react";
import type { Persona } from "@flowstore/core/schema/files/persona";
import { useTestsStore } from "@/lib/store/tests";
import { useSimulateStore } from "@/lib/store/simulate";
import { useUiStore } from "@/lib/store/ui";

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
  const setOpenSimulateTab = useUiStore((s) => s.setOpenSimulateTab);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  function startNew() {
    // Placeholder-first: create with a default name immediately so the
    // user can edit inline. Abandoned placeholders are removed via
    // Delete; they don't reach GitHub until the next Save commits the
    // project. Avoids a modal/prompt on creation.
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

  function useInSimulate(p: Persona) {
    setPersonaPrompt(p.system_prompt);
    setOpenSimulateTab("simulate");
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
        <div className="text-[11px] text-zinc-500">
          {personas.length} {personas.length === 1 ? "persona" : "personas"}
        </div>
        <button
          type="button"
          onClick={startNew}
          title="Create a new persona"
          className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
        >
          + New
        </button>
      </div>

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
  onDelete: () => void;
  onUseInSimulate: () => void;
}

function PersonaRow({
  persona,
  expanded,
  onToggle,
  onSave,
  onDelete,
  onUseInSimulate,
}: PersonaRowProps) {
  // Local draft so edits can be cancelled by collapsing without saving. On
  // expand, hydrate from the saved record. On Save, push to the store.
  const [name, setName] = useState(persona.name ?? "");
  const [notes, setNotes] = useState(persona.notes ?? "");
  const [systemPrompt, setSystemPrompt] = useState(persona.system_prompt);

  useEffect(() => {
    if (expanded) {
      setName(persona.name ?? "");
      setNotes(persona.notes ?? "");
      setSystemPrompt(persona.system_prompt);
    }
  }, [expanded, persona]);

  const dirty =
    name !== (persona.name ?? "") ||
    notes !== (persona.notes ?? "") ||
    systemPrompt !== persona.system_prompt;

  function handleSave() {
    const updated: Persona = {
      $schema: "flowstore://test/persona/v0",
      id: persona.id,
      system_prompt: systemPrompt,
      // Preserve optional fields the editor doesn't surface (model).
      ...(persona.model !== undefined ? { model: persona.model } : {}),
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
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
