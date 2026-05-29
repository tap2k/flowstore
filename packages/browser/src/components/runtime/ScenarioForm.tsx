import { useMemo, useState } from "react";
import type { Spec } from "@flowstore/core/schema/v0";
import type {
  Scenario,
  ScenarioMockBehavior,
} from "@flowstore/core/schema/files/scenario";
import { useSimulateStore } from "@/lib/store/simulate";
import { useTestsStore } from "@/lib/store/tests";
import { useSettingsStore } from "@/lib/store/settings";
import { collectDeclaredVariables } from "@flowstore/core/runtime/contextVars";
import { collectMockableCapabilities } from "@flowstore/core/runtime/capabilityMocks";
import { generateScenarioContent } from "@flowstore/core/runtime/scenarioGen";
import {
  scenarioToRuntime,
  buildScenarioFromRuntime,
} from "@flowstore/core/runtime/scenarioRuntime";
import { GENERATION_MODEL } from "@flowstore/core/files/models";
import { CollapsibleGenerateSection } from "./CollapsibleGenerateSection";
import { VarsEditor } from "./scenario/VarsEditor";
import { MocksEditor } from "./scenario/MocksEditor";

// Run-pill "Scenario" section. Live view onto the simulate-store buffer
// (the world the next run will use). Vars + Mocks editors mutate the
// buffer directly; load/save copies file ↔ buffer; Generate fills both
// halves from the agent's purpose.

interface ScenarioFormProps {
  spec: Spec;
  disabled: boolean;
}

export function ScenarioForm({ spec, disabled }: ScenarioFormProps) {
  const declaredVars = useMemo(() => collectDeclaredVariables(spec), [spec]);
  const mockableCaps = useMemo(() => collectMockableCapabilities(spec), [spec]);

  const contextVars = useSimulateStore((s) => s.contextVars);
  const setContextVar = useSimulateStore((s) => s.setContextVar);
  const setContextVars = useSimulateStore((s) => s.setContextVars);
  const clearContextVars = useSimulateStore((s) => s.clearContextVars);
  const mockReturns = useSimulateStore((s) => s.mockReturns);
  const mockErrors = useSimulateStore((s) => s.mockErrors);
  const setMockOutput = useSimulateStore((s) => s.setMockOutput);
  const setMockReturns = useSimulateStore((s) => s.setMockReturns);
  const setMockError = useSimulateStore((s) => s.setMockError);

  const scenarios = useTestsStore((s) => s.scenarios);
  const saveScenario = useTestsStore((s) => s.saveScenario);
  const deleteScenario = useTestsStore((s) => s.deleteScenario);
  const uniqueScenarioId = useTestsStore((s) => s.uniqueScenarioId);

  // Generation uses Gemini structured output — Google-only regardless of
  // the runtime chat model.
  const apiKey = useSettingsStore((s) => s.googleApiKey);

  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [loadedScenarioId, setLoadedScenarioId] = useState<string | null>(null);
  const [savingAsName, setSavingAsName] = useState<string | null>(null);

  const loadedScenario = loadedScenarioId
    ? scenarios.find((s) => s.id === loadedScenarioId) ?? null
    : null;

  const filledVarsCount = declaredVars.filter(
    (d) => contextVars[d.name] !== undefined,
  ).length;
  const setMocksCount = mockableCaps.filter((c) => {
    const hasReturns = Object.keys(mockReturns[c.capabilityName] ?? {}).length > 0;
    const hasError = mockErrors[c.capabilityName] !== undefined;
    return hasReturns || hasError;
  }).length;

  // Adapt the runtime store shape into the editor's Behavior dict.
  // Keyed by capability NAME (the runtime dimension); MocksEditor's keyOf
  // returns the cap.capabilityName so reads land in this dict.
  const behaviorsByName = useMemo(() => {
    const out: Record<string, ScenarioMockBehavior> = {};
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

  function onMocksEditorChange(capName: string, behavior: ScenarioMockBehavior | undefined) {
    if (behavior === undefined) {
      // Clear both halves for this cap.
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
    // static — clear error, then write each output
    setMockError(capName, null);
    const prev = mockReturns[capName] ?? {};
    const next = (behavior.returns ?? {}) as Record<string, unknown>;
    // Drop outputs that disappeared
    for (const outName of Object.keys(prev)) {
      if (!(outName in next)) setMockOutput(capName, outName, undefined);
    }
    for (const [outName, v] of Object.entries(next)) {
      setMockOutput(capName, outName, v);
    }
  }

  function hydrateBufferFromScenario(sc: Scenario) {
    const { vars, returns, errors } = scenarioToRuntime(spec, sc);
    setContextVars(vars);
    setMockReturns(returns);
    for (const [name, err] of Object.entries(errors)) {
      setMockError(name, err);
    }
  }

  function onLoadScenario(id: string) {
    if (id === "") return;
    const sc = scenarios.find((s) => s.id === id);
    if (!sc) return;
    hydrateBufferFromScenario(sc);
    setLoadedScenarioId(id);
    setOpen(true);
  }

  function onSaveScenario() {
    if (!loadedScenario) return;
    saveScenario(
      buildScenarioFromRuntime(
        spec,
        loadedScenario.id,
        loadedScenario.name,
        loadedScenario.notes,
        contextVars,
        mockReturns,
        mockErrors,
      ),
    );
  }

  function onStartSaveAs() {
    setSavingAsName(loadedScenario?.name ?? "scenario");
  }
  function onConfirmSaveAs() {
    if (savingAsName === null) return;
    const name = savingAsName.trim();
    if (name === "") return;
    const id = uniqueScenarioId(name);
    saveScenario(
      buildScenarioFromRuntime(
        spec,
        id,
        name,
        undefined,
        contextVars,
        mockReturns,
        mockErrors,
      ),
    );
    setLoadedScenarioId(id);
    setSavingAsName(null);
  }
  function onCancelSaveAs() {
    setSavingAsName(null);
  }

  function onDeleteScenario() {
    if (!loadedScenario) return;
    const ok = window.confirm(
      `Delete scenario "${loadedScenario.name || loadedScenario.id}"?`,
    );
    if (!ok) return;
    deleteScenario(loadedScenario.id);
    setLoadedScenarioId(null);
  }

  function onClear() {
    clearContextVars();
    setMockReturns({});
    for (const cap of spec.agent.capabilities ?? []) {
      setMockError(cap.name, null);
    }
    setLoadedScenarioId(null);
  }

  async function onGenerate() {
    if (!apiKey) return;
    if (filledVarsCount > 0 || setMocksCount > 0) {
      const ok = window.confirm("Replace existing vars + mocks with generated ones?");
      if (!ok) return;
    }
    setOpen(true);
    setGenerating(true);
    setGenError(null);
    try {
      const { vars, mocks } = await generateScenarioContent(
        spec,
        apiKey,
        GENERATION_MODEL,
      );
      if (Object.keys(vars).length > 0) setContextVars(vars);
      // Translate scenario mocks (cap_id → cap_name) into runtime shape.
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

  const configured = filledVarsCount > 0 || setMocksCount > 0;

  return (
    <CollapsibleGenerateSection
      title="Scenario"
      countLabel={configured ? "configured" : "empty"}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      onClear={configured ? onClear : undefined}
      onGenerate={onGenerate}
      apiKey={apiKey}
      disabled={disabled}
      generating={generating}
      generateTitle="Use the LLM to fill realistic happy-path vars + mock returns."
    >
      <div className="space-y-3 px-4 pb-4">
        {genError && (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
            {genError}
          </div>
        )}

        <ScenarioLoadSaveRow
          scenarios={scenarios}
          loadedScenarioId={loadedScenarioId}
          savingAsName={savingAsName}
          disabled={disabled || generating}
          onLoadScenario={onLoadScenario}
          onSaveScenario={onSaveScenario}
          onStartSaveAs={onStartSaveAs}
          onChangeSaveAsName={setSavingAsName}
          onConfirmSaveAs={onConfirmSaveAs}
          onCancelSaveAs={onCancelSaveAs}
          onDeleteScenario={onDeleteScenario}
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
      </div>
    </CollapsibleGenerateSection>
  );
}

interface ScenarioLoadSaveRowProps {
  scenarios: Scenario[];
  loadedScenarioId: string | null;
  savingAsName: string | null;
  disabled: boolean;
  onLoadScenario: (id: string) => void;
  onSaveScenario: () => void;
  onStartSaveAs: () => void;
  onChangeSaveAsName: (s: string | null) => void;
  onConfirmSaveAs: () => void;
  onCancelSaveAs: () => void;
  onDeleteScenario: () => void;
}

function ScenarioLoadSaveRow({
  scenarios,
  loadedScenarioId,
  savingAsName,
  disabled,
  onLoadScenario,
  onSaveScenario,
  onStartSaveAs,
  onChangeSaveAsName,
  onConfirmSaveAs,
  onCancelSaveAs,
  onDeleteScenario,
}: ScenarioLoadSaveRowProps) {
  return (
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
      {loadedScenarioId && (
        <button
          type="button"
          onClick={onSaveScenario}
          disabled={disabled}
          title={`Update tests/scenarios/${loadedScenarioId}.scenario.json with the current buffer.`}
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
          title="Save current buffer as a new scenario."
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
            onChange={(e) => onChangeSaveAsName(e.target.value)}
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
      {loadedScenarioId && (
        <button
          type="button"
          onClick={onDeleteScenario}
          disabled={disabled}
          title={`Delete tests/scenarios/${loadedScenarioId}.scenario.json.`}
          className="rounded border border-red-300 bg-white px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-50 disabled:opacity-40"
        >
          delete
        </button>
      )}
    </div>
  );
}
