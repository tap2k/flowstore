import { useMemo, useState } from "react";
import type { Spec } from "@flowstore/core/schema/v0";
import type { MockBehavior } from "@flowstore/core/schema/files/mockBehavior";
import { useSimulateStore } from "@/lib/store/simulate";
import type { AsrLevel } from "@/lib/runtime/asrShape";
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
// save copies file ↔ buffer; ✨ Generate (shown only when no saved persona
// is loaded, sitting by "save as…") fills all three, seeding off the prompt
// box as notes — or grounding against the agent's purpose + business goals
// when it's empty. Auto-run knobs (model picker, turn limit, ▶/■) stay
// attached to this section since the persona is what drives them.

interface PersonaFormProps {
  spec: Spec;
  disabled: boolean;
}

export function PersonaForm({ spec, disabled }: PersonaFormProps) {
  const declaredVars = useMemo(() => collectDeclaredVariables(spec), [spec]);
  const mockableCaps = useMemo(() => collectMockableCapabilities(spec), [spec]);

  const personaPrompt = useSimulateStore((s) => s.personaPrompt);
  const autoRun = useSimulateStore((s) => s.autoRun);
  const mode = useSimulateStore((s) => s.mode);
  const status = useSimulateStore((s) => s.status);
  const hasTurns = useSimulateStore((s) => s.transcript.length > 0);
  const personaTurnLimit = useSimulateStore((s) => s.personaTurnLimit);
  const personaTurnsLeft = useSimulateStore((s) => s.personaTurnsLeft);
  const setPersonaPrompt = useSimulateStore((s) => s.setPersonaPrompt);
  const setPersonaTraits = useSimulateStore((s) => s.setPersonaTraits);
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
  const asrLevel = useSettingsStore((s) => s.simulateAsrLevel);
  const setSimulateAsrLevel = useSettingsStore((s) => s.setSimulateAsrLevel);
  const bargeIn = useSettingsStore((s) => s.simulateBargeIn);
  const setSimulateBargeIn = useSettingsStore((s) => s.setSimulateBargeIn);
  const personaHasKey = hasKeyForModel(model);
  // ASR shaping only makes sense for a voice/multimodal agent (a text agent
  // never sees raw transcription); gate the control on it.
  const voiceAgent =
    spec.agent.meta.modality === "voice" || spec.agent.meta.modality === "multimodal";

  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [loadedPersonaId, setLoadedPersonaId] = useState<string | null>(null);
  const [savingAsName, setSavingAsName] = useState<string | null>(null);

  const configured = personaPrompt.trim().length > 0;
  // Disambiguate the three non-running states so the run button doesn't show a
  // bare "▶" for all of them: the conversation concluded ([DONE]/ended) vs. it
  // paused mid-run at the turn limit vs. a fresh idle start.
  const conversationEnded = !autoRun && status === "ended";
  const pausedMidRun = !autoRun && status !== "ended" && hasTurns;
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
    setPersonaTraits(persona.traits);
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
    setOpen(true);
    setGenerating(true);
    setGenError(null);
    try {
      // Seed generation with whatever's in the prompt box (treated as notes);
      // empty falls back to grounding against agent purpose + business goals.
      const { systemPrompt: nextPrompt, vars, mocks } = await generatePersonaContent(
        spec,
        dispatch.provider,
        dispatchKey,
        dispatch.wireModel,
        { notes: personaPrompt.trim() || undefined },
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
          <span className="text-[10px] text-zinc-500">Turns:</span>
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
            disabled={!configured || !personaHasKey || mode === "voice"}
            title={
              mode === "voice"
                ? "Persona auto-run is text/runner only — voice is mic-driven."
                : !personaHasKey
                ? "Add an API key in Settings for the model the persona picker is set to."
                : !configured
                  ? "Write a persona system prompt to start."
                  : autoRun
                    ? "Stop the persona. An in-flight reply is dropped."
                    : conversationEnded
                      ? "Conversation ended. Click to restart the persona from a fresh session."
                      : pausedMidRun
                        ? "Paused (stopped or hit the turn limit). Click to run more turns."
                        : "Start: persona runs for the configured number of turns, then pauses. Click again for more."
            }
            className={
              autoRun
                ? "rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-100 disabled:opacity-40"
                : conversationEnded
                  ? "rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                  : "rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            }
          >
            {autoRun ? "■" : conversationEnded ? "✓" : "▶"}
          </button>
          {mode === "voice" ? null : autoRun ? (
            <span className="text-[10px] text-zinc-400">· {personaTurnsLeft} left</span>
          ) : conversationEnded ? (
            <span className="text-[10px] text-emerald-600">· done</span>
          ) : pausedMidRun ? (
            <span className="text-[10px] text-amber-600">· paused</span>
          ) : null}
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
            {!loadedPersona && dispatchKey && (
              <button
                type="button"
                onClick={onGenerate}
                disabled={disabled || generating}
                title="Draft a full persona (prompt + vars + mocks), seeded by the prompt text below — or grounded against the agent's purpose + business goals when it's empty. Uses the configured Generate model."
                className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                {generating ? "Generating…" : "✨ Generate"}
              </button>
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
            {configured && (
              <button
                type="button"
                onClick={onClear}
                disabled={disabled || generating}
                title="Clear the persona prompt + world from the buffer."
                className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                clear
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

          {/* Persona model + (voice agents only) the browser voice-realism
              knobs: ASR shaping + barge-in, a browser approximation of the
              regression harness's _persona.py. Both apply only in text/prompt
              mode (Live voice handles real ASR + interruptions itself). The
              selects self-label, so no row label. */}
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
            <ModelPicker
              value={model}
              onChange={setSimulatePersonaModel}
              className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
            {voiceAgent && (
              <>
                <select
                  value={asrLevel}
                  onChange={(e) => setSimulateAsrLevel(e.target.value as AsrLevel)}
                  title="ASR shaping: garble the persona's turns like raw transcription (lowercase, no punctuation, fillers/false-starts) before they reach the agent."
                  className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                >
                  <option value="off">asr: off</option>
                  <option value="clean">asr: clean</option>
                  <option value="light">asr: light</option>
                  <option value="heavy">asr: heavy</option>
                </select>
                <select
                  value={String(bargeIn)}
                  onChange={(e) => setSimulateBargeIn(Number(e.target.value))}
                  title="Barge-in: how often the caller cuts the agent off mid-reply (trims the prior agent turn before the persona responds). A run-level floor — max'd with the persona's barge_in trait. Text/prompt mode only."
                  className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                >
                  <option value="0">barge: off</option>
                  <option value="0.3">barge: low</option>
                  <option value="0.6">barge: high</option>
                </select>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
