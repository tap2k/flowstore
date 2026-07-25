import { useEffect, useMemo, useState } from "react";
import type { Persona } from "@flowstore/core/schema/files/persona";
import type { MockBehavior } from "@flowstore/core/schema/files/mockBehavior";
import { useTestsStore } from "@/lib/store/tests";
import { useSimulateStore } from "@/lib/store/simulate";
import { useUiStore } from "@/lib/store/ui";
import { useSpecStore } from "@/lib/store/spec";
import { resolveDispatch, useSettingsStore } from "@/lib/store/settings";
import { collectDeclaredVariables } from "@flowstore/core/runtime/contextVars";
import { collectMockableCapabilities } from "@flowstore/core/runtime/capabilityMocks";
import { generatePersonaContent } from "@flowstore/core/runtime/personaContentGen";
import { personaToRuntime } from "@flowstore/core/runtime/personaRuntime";
import { VarsEditor } from "./persona/VarsEditor";
import { MocksEditor } from "./persona/MocksEditor";
import { TagChips, TagsField } from "./TagsUI";

// Saved-persona library for the Run pill's Personas tab. Each row expands
// inline to edit name + notes + tags + system_prompt (the actor's voice) +
// the complete, standalone-runnable fixture (vars + mocks — character facts
// plus a baseline situation, so the persona runs with no case; a case
// overrides specific keys per scenario). Personas are file-backed
// (tests/personas/<id>.persona.json); save / delete mark the project dirty
// and ride on the next GitHub Save.

export function PersonasPanel() {
  const personas = useTestsStore((s) => s.personas);
  const cases = useTestsStore((s) => s.cases);
  const golds = useTestsStore((s) => s.golds);
  const savePersona = useTestsStore((s) => s.savePersona);
  const deletePersona = useTestsStore((s) => s.deletePersona);
  const uniquePersonaId = useTestsStore((s) => s.uniquePersonaId);

  // Shared tag vocabulary across the whole testing surface, so a persona can
  // be filtered with the same labels as the cases/golds it sits beside.
  const tagSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const p of personas) for (const t of p.tags ?? []) set.add(t);
    for (const c of cases) for (const t of c.tags ?? []) set.add(t);
    for (const g of golds) for (const t of g.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [personas, cases, golds]);
  const reset = useSimulateStore((s) => s.reset);
  const setPersonaPrompt = useSimulateStore((s) => s.setPersonaPrompt);
  const setPersonaTraits = useSimulateStore((s) => s.setPersonaTraits);
  const setActiveCaseId = useSimulateStore((s) => s.setActiveCaseId);
  const setContextVars = useSimulateStore((s) => s.setContextVars);
  const setMockReturns = useSimulateStore((s) => s.setMockReturns);
  const setMockError = useSimulateStore((s) => s.setMockError);
  const setOpenSimulateTab = useUiStore((s) => s.setOpenSimulateTab);
  const spec = useSpecStore((s) => s.spec);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const dispatch = resolveDispatch(defaultModel);
  const apiKey = dispatch.apiKey;

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
      name: defaultName,
      system_prompt: "",
    });
    setSelectedId(id);
  }

  // When an API key + spec are present, "+ New" opens the generate dialog so
  // the persona is born complete (vars + mocks + system_prompt). Without them
  // it falls back to a skeleton the user can fill by hand.
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
      if (!dispatch.provider) throw new Error("Generate model has no provider");
      const { systemPrompt, vars, mocks } = await generatePersonaContent(
        spec,
        dispatch.provider,
        apiKey,
        dispatch.wireModel,
        { name: name || undefined, notes: notes || undefined },
      );
      const id = uniquePersonaId(name || "persona");
      savePersona({
        $schema: "flowstore://test/persona/v0",
        id,
        ...(name ? { name } : {}),
        ...(notes ? { notes } : {}),
        system_prompt: systemPrompt,
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

  async function useInSimulate(p: Persona) {
    await reset();
    setPersonaPrompt(p.system_prompt ?? "");
    setPersonaTraits(p.traits);
    // Hydrate the simulate buffer with this persona's world so exploration
    // starts in a coherent context.
    if (spec) {
      const { vars, returns, errors } = personaToRuntime(spec, p);
      setContextVars(vars);
      setMockReturns(returns);
      for (const [name, err] of Object.entries(errors)) {
        setMockError(name, err);
      }
    }
    // Picking a persona = starting a free exploration. Drop any
    // active-case binding so the Active-case strip and verdict surfaces
    // don't linger and conflict with what's actually being run.
    setActiveCaseId(null);
    setOpenSimulateTab("simulate");
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-border-default px-3 py-1.5">
        <div className="text-[11px] text-text-tertiary">
          {personas.length} {personas.length === 1 ? "persona" : "personas"}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={apiKey && spec ? startGenerate : startNew}
            disabled={generating !== null}
            title={
              apiKey && spec
                ? "Create a new persona — generates system prompt, vars, and mocks from a name + notes prompt."
                : "Create a placeholder persona — fill prompt + world inline."
            }
            className="rounded border border-border-default bg-surface-panel px-2 py-0.5 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-40"
          >
            + New
          </button>
        </div>
      </div>

      {generating && (
        <div className="space-y-2 border-b border-border-default bg-surface-panel px-3 py-2 text-[11px]">
          <div className="font-medium text-text-primary">Generate persona</div>
          {generating.error && (
            <div className="rounded border border-state-error-line bg-state-error-bg px-2 py-1 text-[11px] text-state-error-fg">
              {generating.error}
            </div>
          )}
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-text-tertiary">
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
              className="w-full rounded border border-border-default bg-surface-panel px-2 py-1 text-[11px]"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-text-tertiary">
              notes
            </label>
            <textarea
              value={generating.notes}
              onChange={(e) =>
                setGenerating({ ...generating, notes: e.target.value })
              }
              placeholder="Who is this user, why are they calling, what's their style?"
              rows={3}
              className="w-full resize-y rounded border border-border-default bg-surface-panel p-1.5 text-[11px] leading-snug"
            />
          </div>
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setGenerating(null)}
              disabled={generating.busy}
              className="rounded border border-border-default bg-surface-panel px-2 py-0.5 text-[10px] text-text-secondary hover:bg-surface-hover disabled:opacity-40"
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
              className="rounded-md bg-emphasis px-2 py-0.5 text-[10px] font-medium text-emphasis-fg hover:bg-emphasis-hover disabled:opacity-40"
            >
              {generating.busy ? "Generating…" : "Generate"}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {personas.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-text-tertiary">
            No saved personas yet. Click <span className="font-medium">+ New</span> to add one,
            or save the current Simulate-tab persona via the PersonaForm.
          </div>
        ) : (
          <ul className="divide-y divide-border-default">
            {personas.map((p) => (
              <PersonaRow
                key={p.id}
                persona={p}
                tagSuggestions={tagSuggestions}
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
                  const ok = window.confirm(`Delete persona "${p.name || p.id}"? Cases bound to it will lose the binding.`);
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
  tagSuggestions: string[];
  expanded: boolean;
  onToggle: () => void;
  onSave: (p: Persona) => void;
  onCopy: () => void;
  onDelete: () => void;
  onUseInSimulate: () => void;
}

function PersonaRow({
  persona,
  tagSuggestions,
  expanded,
  onToggle,
  onSave,
  onCopy,
  onDelete,
  onUseInSimulate,
}: PersonaRowProps) {
  const spec = useSpecStore((s) => s.spec);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const dispatch = resolveDispatch(defaultModel);
  const apiKey = dispatch.apiKey;
  const declaredVars = useMemo(() => collectDeclaredVariables(spec), [spec]);
  const mockableCaps = useMemo(() => collectMockableCapabilities(spec), [spec]);

  // Local draft so edits can be cancelled by collapsing without saving. On
  // expand, hydrate from the saved record. On Save, push to the store.
  const [name, setName] = useState(persona.name ?? "");
  const [notes, setNotes] = useState(persona.notes ?? "");
  const [tags, setTags] = useState<string[]>(persona.tags ?? []);
  const [systemPrompt, setSystemPrompt] = useState(persona.system_prompt ?? "");
  const [vars, setVars] = useState<Record<string, unknown>>(persona.vars ?? {});
  const [mocks, setMocks] = useState<Record<string, MockBehavior>>(persona.mocks ?? {});
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  useEffect(() => {
    if (expanded) {
      setName(persona.name ?? "");
      setNotes(persona.notes ?? "");
      setTags(persona.tags ?? []);
      setSystemPrompt(persona.system_prompt ?? "");
      setVars(persona.vars ?? {});
      setMocks(persona.mocks ?? {});
      setRegenError(null);
    }
  }, [expanded, persona]);

  const varsCount = Object.keys(vars).length;
  const mocksCount = Object.keys(mocks).length;

  const dirty =
    name !== (persona.name ?? "") ||
    notes !== (persona.notes ?? "") ||
    JSON.stringify(tags) !== JSON.stringify(persona.tags ?? []) ||
    systemPrompt !== (persona.system_prompt ?? "") ||
    JSON.stringify(vars) !== JSON.stringify(persona.vars ?? {}) ||
    JSON.stringify(mocks) !== JSON.stringify(persona.mocks ?? {});

  function handleSave() {
    const updated: Persona = {
      $schema: "flowstore://test/persona/v0",
      id: persona.id,
      // Preserve optional fields the editor doesn't surface (model).
      ...(persona.model !== undefined ? { model: persona.model } : {}),
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      system_prompt: systemPrompt,
      ...(Object.keys(vars).length > 0 ? { vars } : {}),
      ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
    };
    onSave(updated);
  }

  async function handleRegenerate() {
    if (!spec || !apiKey || !dispatch.provider) return;
    // Regenerate is a full overwrite (prompt + intrinsic vars + mocks).
    // Confirm when anything is already filled so a hand-tuned persona
    // doesn't silently lose curated content.
    const hasContent =
      systemPrompt.trim().length > 0 ||
      Object.keys(vars).length > 0 ||
      Object.keys(mocks).length > 0;
    if (hasContent) {
      const ok = window.confirm(
        "Regenerate replaces system_prompt + vars + mocks from this row's name + notes. Continue?",
      );
      if (!ok) return;
    }
    setRegenerating(true);
    setRegenError(null);
    try {
      const { systemPrompt: nextPrompt, vars: nextVars, mocks: nextMocks } =
        await generatePersonaContent(
          spec,
          dispatch.provider,
          apiKey,
          dispatch.wireModel,
          { name: name.trim() || undefined, notes: notes.trim() || undefined },
        );
      setSystemPrompt(nextPrompt);
      setVars(nextVars);
      setMocks(nextMocks);
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : "Regenerate failed.");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface-hover"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-text-primary">
            {persona.name || persona.id}
          </div>
          <div className="truncate font-mono text-[10px] text-text-tertiary">
            {persona.id} | {varsCount} vars · {mocksCount} mocks
          </div>
          <TagChips tags={persona.tags} />
        </div>
        <span className="ml-2 text-text-tertiary">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border-subtle bg-surface-sunken/50 px-3 py-2 text-[11px]">
          {regenError && (
            <div className="rounded border border-state-error-line bg-state-error-bg px-2 py-1 text-state-error-fg">
              {regenError}
            </div>
          )}
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-text-tertiary">
              name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Human-readable label"
              className="w-full rounded border border-border-default bg-surface-panel px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-focus-ring"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-text-tertiary">
              notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What does this persona test?"
              className="w-full rounded border border-border-default bg-surface-panel px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-focus-ring"
            />
          </div>

          <TagsField
            tags={tags}
            suggestions={tagSuggestions}
            listId={`persona-tags-${persona.id}`}
            onChange={setTags}
          />

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-text-tertiary">
              system_prompt
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={10}
              placeholder="System prompt for the persona playing the user."
              className="w-full resize-y rounded border border-border-default bg-surface-panel p-2 font-mono text-[11px] leading-snug text-text-primary focus:outline-none focus:ring-1 focus:ring-focus-ring"
            />
          </div>

          <div className="text-[10px] uppercase tracking-wide text-text-tertiary">
            fixture
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
              title="Delete this persona"
              className="rounded border border-state-error-line bg-surface-panel px-2 py-1 text-[11px] text-state-error-fg hover:bg-state-error-bg"
            >
              Delete
            </button>
            <div className="flex items-center gap-1">
              {apiKey && (
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  title="Regenerate system_prompt + vars + mocks from this row's name + notes (replaces them; save to persist)."
                  className="rounded border border-border-default bg-surface-panel px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-40"
                >
                  {regenerating ? "Regenerating…" : "✨ Regenerate"}
                </button>
              )}
              <button
                type="button"
                onClick={onUseInSimulate}
                title="Load this persona's prompt + world (vars + mocks) into the Simulate tab buffer."
                className="rounded border border-border-default bg-surface-panel px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover"
              >
                Simulate ▶
              </button>
              <button
                type="button"
                onClick={onCopy}
                title="Duplicate this persona as a new one — handy for variant authoring (tweak one mock)."
                className="rounded border border-border-default bg-surface-panel px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || systemPrompt.trim() === ""}
                title={
                  systemPrompt.trim() === ""
                    ? "A persona needs a system_prompt before it can be saved."
                    : dirty
                      ? "Save changes"
                      : "No unsaved edits"
                }
                className="rounded-md bg-emphasis px-3 py-1 text-[11px] font-medium text-emphasis-fg hover:bg-emphasis-hover disabled:opacity-40"
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
