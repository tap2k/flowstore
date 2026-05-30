import { useMemo, useState } from "react";
import type { Spec } from "@flowstore/core/schema/v0";
import type { MockBehavior } from "@flowstore/core/schema/files/mockBehavior";
import { useSimulateStore } from "@/lib/store/simulate";
import { useTestsStore } from "@/lib/store/tests";
import { hasKeyForModel, resolveDispatch, useSettingsStore } from "@/lib/store/settings";
import { generatePersonaContent } from "@flowstore/core/runtime/personaContentGen";
import {
  buildPersonaFromRuntime,
  personaToRuntime,
} from "@flowstore/core/runtime/personaRuntime";
import { collectDeclaredVariables } from "@flowstore/core/runtime/contextVars";
import { collectMockableCapabilities } from "@flowstore/core/runtime/capabilityMocks";
import { ModelPicker } from "./ModelPicker";
import { VarsEditor } from "./persona/VarsEditor";
import { MocksEditor } from "./persona/MocksEditor";

// Run-pill "Persona" section. Live view onto the simulate-store buffer:
// system_prompt + vars + mocks editors mutate the buffer directly. Load /
// save copies file ↔ buffer; ✨ Generate fills all three from name+notes
// (or, when neither is provided, grounds against the agent's purpose +
// business goals alone). Auto-run knobs (model picker, turn limit, ▶/■)
// stay attached to this section since the persona is what drives them.

interface PersonaFormProps {
  spec: Spec;
  disabled: boolean;
}

export function PersonaForm({ spec, disabled }: PersonaFormProps) {
  const declaredVars = useMemo(() => collectDeclaredVariables(spec), [spec]);
  const mockableCaps = useMemo(() => collectMockableCapabilities(spec), [spec]);

  const personaPrompt = useSimulateStore((s) => s.personaPrompt);
  const autoRun = useSimulateStore((s) => s.autoRun);
  const personaTurnLimit = useSimulateStore((s) => s.personaTurnLimit);
  const personaTurnsLeft = useSimulateStore((s) => s.personaTurnsLeft);
  const setPersonaPrompt = useSimulateStore((s) => s.setPersonaPrompt);
  const setAutoRun = useSimulateStore((s) => s.setAutoRun);
  const setPersonaTurnLimit = useSimulateStore((s) => s.setPersonaTurnLimit);

  const contextVars = useSimulateStore((s) => s.contextVars);
  const setContextVar = useSimulateStore((s) => s.setContextVar);
  const setContextVars = useSimulateStore((s) => s.setContextVars);
  const clearContextVars = useSimulateStore((s) => s.clearContextVars);
  const mockReturns = useSimulateStore((s) => s.mockReturns);
  const mockErrors = useSimulateStore((s) => s.mockErrors);
  const setMockOutput = useSimulateStore((s) => s.setMockOutput);
  const setMockReturns = useSimulateStore((s) => s.setMockReturns);
  const setMockError = useSimulateStore((s) => s.setMockError);

  const personas = useTestsStore((s) => s.personas);
  const savePersona = useTestsStore((s) => s.savePersona);
  const deletePersona = useTestsStore((s) => s.deletePersona);
  const uniquePersonaId = useTestsStore((s) => s.uniquePersonaId);

  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const dispatch = resolveDispatch(defaultModel);
  const dispatchKey = dispatch.apiKey;
  const model = useSettingsStore((s) => s.simulatePersonaModel);
  const setSimulatePersonaModel = useSettingsStore((s) => s.setSimulatePersonaModel);
  const personaHasKey = hasKeyForModel(model);

  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [loadedPersonaId, setLoadedPersonaId] = useState<string | null>(null);
  const [savingAsName, setSavingAsName] = useState<string | null>(null);

  const configured = personaPrompt.trim().length > 0;
  const loadedPersona = loadedPersonaId
    ? personas.find((p) => p.id === loadedPersonaId) ?? null
    : null;

  // Adapt the runtime store shape into the editor's Behavior dict, keyed
  // by capability NAME (the runtime dimension). MocksEditor's keyOf
  // returns cap.capabilityName so reads land in this dict.
  const behaviorsByName = useMemo(() => {
    const out: Record<string, MockBehavior> = {};
    for (const cap of mockableCaps) {
      const err = mockErrors[cap.capabilityName];
      if (err !== undefined && err !== null) {
        out[cap.capabilityName] = { kind: "error", error: err };
        continue;
      }
      const returns = mockReturns[cap.capabilityName] ?? {};
      if (Object.keys(returns).length > 0) {
        out[cap.capabilityName] = { kind: "static", returns };
      }
    }
    return out;
  }, [mockableCaps, mockReturns, mockErrors]);

  function onMocksEditorChange(capName: string, behavior: MockBehavior | undefined) {
    if (behavior === undefined) {
      setMockError(capName, null);
      for (const outName of Object.keys(mockReturns[capName] ?? {})) {
        setMockOutput(capName, outName, undefined);
      }
      return;
    }
    if (behavior.kind === "error") {
      setMockError(capName, behavior.error);
      return;
    }
    setMockError(capName, null);
    const prev = mockReturns[capName] ?? {};
    const next = (behavior.returns ?? {}) as Record<string, unknown>;
    for (const outName of Object.keys(prev)) {
      if (!(outName in next)) setMockOutput(capName, outName, undefined);
    }
    for (const [outName, v] of Object.entries(next)) {
      setMockOutput(capName, outName, v);
    }
  }

  function onLoadPersona(id: string) {
    if (id === "") return;
    const persona = personas.find((p) => p.id === id);
    if (!persona) return;
    setPersonaPrompt(persona.system_prompt ?? "");
    // Hydrate the buffer with this persona's full world so exploration
    // starts in the configured state. Reproducibility lives at the case
    // level; this is the convenience hookup for the free-explore path.
    const { vars, returns, errors } = personaToRuntime(spec, persona);
    setContextVars(vars);
    setMockReturns(returns);
    for (const [name, err] of Object.entries(errors)) {
      setMockError(name, err);
    }
    setLoadedPersonaId(id);
    setOpen(true);
  }

  function onSavePersona() {
    if (!loadedPersona) return;
    savePersona(
      buildPersonaFromRuntime({
        spec,
        id: loadedPersona.id,
        name: loadedPersona.name,
        notes: loadedPersona.notes,
        systemPrompt: personaPrompt,
        vars: contextVars,
        returns: mockReturns,
        errors: mockErrors,
        model: loadedPersona.model,
      }),
    );
  }

  function onStartSaveAs() {
    if (!configured) return;
    setSavingAsName(loadedPersona?.name ?? "persona");
  }
  function onConfirmSaveAs() {
    if (savingAsName === null) return;
    const name = savingAsName.trim();
    if (name === "") return;
    const id = uniquePersonaId(name);
    savePersona(
      buildPersonaFromRuntime({
        spec,
        id,
        name,
        systemPrompt: personaPrompt,
        vars: contextVars,
        returns: mockReturns,
        errors: mockErrors,
      }),
    );
    setLoadedPersonaId(id);
    setSavingAsName(null);
  }
  function onCancelSaveAs() {
    setSavingAsName(null);
  }

  function onDeletePersona() {
    if (!loadedPersona) return;
    const ok = window.confirm(
      `Delete persona "${loadedPersona.name || loadedPersona.id}"?`,
    );
    if (!ok) return;
    deletePersona(loadedPersona.id);
    setLoadedPersonaId(null);
  }

  function onClear() {
    setPersonaPrompt("");
    clearContextVars();
    setMockReturns({});
    for (const cap of spec.agent.capabilities ?? []) {
      setMockError(cap.name, null);
    }
    setLoadedPersonaId(null);
  }

  async function onGenerate() {
    if (!dispatchKey || !dispatch.provider) return;
    if (configured) {
      const ok = window.confirm("Replace the current persona (prompt + world) with a generated one?");
      if (!ok) return;
    }
    setOpen(true);
    setGenerating(true);
    setGenError(null);
    try {
      const { systemPrompt: nextPrompt, vars, mocks } = await generatePersonaContent(
        spec,
        dispatch.provider,
        dispatchKey,
        dispatch.wireModel,
      );
      setPersonaPrompt(nextPrompt);
      if (Object.keys(vars).length > 0) setContextVars(vars);
      // Translate persona mocks (cap_id → cap_name) into runtime shape.
      const idToName = new Map<string, string>();
      for (const cap of spec.agent.capabilities ?? []) idToName.set(cap.id, cap.name);
      const nextReturns: Record<string, Record<string, unknown>> = {};
      for (const [capId, behavior] of Object.entries(mocks)) {
        const name = idToName.get(capId);
        if (!name || behavior.kind !== "static") continue;
        const r = behavior.returns;
        if (typeof r === "object" && r !== null && !Array.isArray(r)) {
          nextReturns[name] = r as Record<string, unknown>;
        }
      }
      if (Object.keys(nextReturns).length > 0) setMockReturns(nextReturns);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
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
          Persona
          <span className="ml-1 text-zinc-400">
            {configured ? "configured" : "empty"}
          </span>
        </button>
        <div className="flex items-center gap-1">
          {configured && (
            <button
              type="button"
              onClick={onClear}
              disabled={disabled || generating}
              className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              title="Clear the persona prompt + world from the buffer."
            >
              Clear
            </button>
          )}
          {dispatchKey && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={disabled || generating}
              className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              title="Draft a persona (prompt + vars + mocks) from the agent's purpose and business goals. Uses the configured Generate model."
            >
              {generating ? "Generating…" : "✨ Generate"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="space-y-2 px-4 pb-3">
          {genError && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
              {genError}
            </div>
          )}
          <div className="flex items-center gap-1 text-[10px] text-zinc-600">
            <select
              value={loadedPersonaId ?? ""}
              onChange={(e) => onLoadPersona(e.target.value)}
              disabled={disabled || generating || personas.length === 0}
              className="max-w-[8rem] truncate rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              <option value="">
                {personas.length === 0 ? "no saved personas" : "load saved…"}
              </option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
            {loadedPersona && (
              <button
                type="button"
                onClick={onSavePersona}
                disabled={disabled || generating}
                title={`Update tests/personas/${loadedPersona.id}.persona.json with the current buffer.`}
                className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                save
              </button>
            )}
            {savingAsName === null ? (
              <button
                type="button"
                onClick={onStartSaveAs}
                disabled={disabled || generating || !configured}
                title="Save current buffer (prompt + vars + mocks) as a new persona file."
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
            {loadedPersona && (
              <button
                type="button"
                onClick={onDeletePersona}
                disabled={disabled || generating}
                title={`Delete tests/personas/${loadedPersona.id}.persona.json.`}
                className="rounded border border-red-300 bg-white px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                delete
              </button>
            )}
          </div>
          <textarea
            value={personaPrompt}
            onChange={(e) => setPersonaPrompt(e.target.value)}
            disabled={disabled || generating}
            rows={8}
            placeholder={
              "System prompt for the persona playing the user.\n\nE.g.: You are a customer who ordered a laptop 3 days ago. The screen arrived cracked (order #12345). You are terse and impatient. Reply as the user would; emit [DONE] when satisfied."
            }
            className="w-full resize-y rounded border border-zinc-300 bg-white p-2 font-mono text-[11px] leading-snug text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400 disabled:bg-zinc-50"
          />

          <VarsEditor
            declared={declaredVars}
            values={contextVars}
            disabled={disabled || generating}
            onChange={(name, value) => setContextVar(name, value)}
          />

          <MocksEditor
            caps={mockableCaps}
            behaviors={behaviorsByName}
            disabled={disabled || generating}
            keyOf={(cap) => cap.capabilityName}
            onChange={onMocksEditorChange}
          />

          <div className="flex items-center gap-2 text-[10px] text-zinc-500">
            <span>Model:</span>
            <ModelPicker
              value={model}
              onChange={setSimulatePersonaModel}
              className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
            <span className="ml-2">Turns:</span>
            <input
              type="number"
              min={1}
              max={200}
              value={personaTurnLimit}
              onChange={(e) => setPersonaTurnLimit(parseInt(e.target.value, 10))}
              disabled={disabled || autoRun}
              title="Hard cap on user turns. Stops the loop if the agent gets stuck."
              className="w-10 rounded border border-zinc-300 bg-white px-1 py-0.5 text-[11px] text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400 disabled:bg-zinc-50"
            />
            <button
              type="button"
              onClick={() => setAutoRun(!autoRun)}
              disabled={!configured || !personaHasKey}
              title={
                !personaHasKey
                  ? "Add an API key in Settings for the model the persona picker is set to."
                  : !configured
                    ? "Write a persona system prompt above to start."
                    : autoRun
                      ? "Stop the persona. An in-flight reply is dropped."
                      : "Start: persona runs for the configured number of turns, then pauses. Click again for more."
              }
              className={
                autoRun
                  ? "rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-100 disabled:opacity-40"
                  : "rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              }
            >
              {autoRun ? "■" : "▶"}
            </button>
            {autoRun && (
              <span className="text-zinc-400">· {personaTurnsLeft} left</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
