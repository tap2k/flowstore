import { useMemo, useState } from "react";
import type { Spec } from "@flowstore/core/schema/v0";
import type {
  Scenario,
  ScenarioMockBehavior,
} from "@flowstore/core/schema/files/scenario";
import { useSimulateStore } from "@/lib/store/simulate";
import { useTestsStore } from "@/lib/store/tests";
import { useSettingsStore } from "@/lib/store/settings";
import {
  collectDeclaredVariables,
  type DeclaredVariable,
} from "@flowstore/core/runtime/contextVars";
import {
  collectMockableCapabilities,
  type MockableCapability,
} from "@flowstore/core/runtime/capabilityMocks";
import { generateContextVars } from "@flowstore/core/runtime/contextVarsGen";
import { generateCapabilityMocks } from "@flowstore/core/runtime/capabilityMocksGen";
import { BUILT_IN_MODELS } from "@flowstore/core/files/models";
import { CollapsibleGenerateSection } from "./CollapsibleGenerateSection";
import { TypedValueInput } from "./TypedValueInput";

// Run-pill "Scenario" section. Two collapsible sub-sections (Vars, Mocks)
// render the live simulate-store buffer that the next run will use.
//
// The buffer IS the source of truth; "load saved" copies a scenario file
// into the buffer, "save" writes the buffer back to the loaded file, and
// "save as…" mints a new scenario file from the buffer. Edits stay
// in-memory until persisted.

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
  // Tracks which saved scenario the current buffer was loaded from (or
  // saved-as). Cleared on Clear.
  const [loadedScenarioId, setLoadedScenarioId] = useState<string | null>(null);
  const [savingAsName, setSavingAsName] = useState<string | null>(null);

  const loadedScenario = loadedScenarioId
    ? scenarios.find((s) => s.id === loadedScenarioId) ?? null
    : null;

  const filledVarsCount = declaredVars.filter(
    (d) => contextVars[d.name] !== undefined,
  ).length;
  const setMocksCount = mockableCaps.filter((c) => {
    const hasReturns =
      Object.keys(mockReturns[c.capabilityName] ?? {}).length > 0;
    const hasError = mockErrors[c.capabilityName] !== undefined;
    return hasReturns || hasError;
  }).length;

  function buildScenarioFromBuffer(id: string, name: string): Scenario {
    // Translate the simulate-store buffer back into the scenario shape.
    // Mock returns are keyed by capability NAME at runtime; scenarios
    // store by capability ID. Spec provides the mapping.
    const vars: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(contextVars)) {
      if (v === undefined || v === null || v === "") continue;
      vars[k] = v;
    }
    const mocks: Record<string, ScenarioMockBehavior> = {};
    const nameToId = new Map<string, string>();
    for (const cap of spec.agent.capabilities ?? []) {
      nameToId.set(cap.name, cap.id);
    }
    for (const cap of mockableCaps) {
      const cid = nameToId.get(cap.capabilityName);
      if (!cid) continue;
      const err = mockErrors[cap.capabilityName];
      if (err !== undefined && err !== null) {
        mocks[cid] = { kind: "error", error: err };
        continue;
      }
      const returns = mockReturns[cap.capabilityName] ?? {};
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(returns)) {
        if (v === undefined || v === null || v === "") continue;
        cleaned[k] = v;
      }
      if (Object.keys(cleaned).length > 0) {
        mocks[cid] = { kind: "static", returns: cleaned };
      }
    }
    return {
      $schema: "flowstore://test/scenario/v0",
      id,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(Object.keys(vars).length > 0 ? { vars } : {}),
      ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
    };
  }

  function hydrateBufferFromScenario(sc: Scenario) {
    // Replace contextVars wholesale (the loaded scenario IS the world).
    setContextVars(sc.vars ?? {});
    // Apply mocks per cap; caps NOT listed in the scenario get cleared so
    // no stale state lingers from a previously-loaded scenario.
    const idToName = new Map<string, string>();
    for (const cap of spec.agent.capabilities ?? []) {
      idToName.set(cap.id, cap.name);
    }
    const nextReturns: Record<string, Record<string, unknown>> = {};
    const nextErrors: Record<string, string | null> = {};
    for (const cap of spec.agent.capabilities ?? []) {
      nextErrors[cap.name] = null;
    }
    for (const [capId, behavior] of Object.entries(sc.mocks ?? {})) {
      const name = idToName.get(capId);
      if (!name) continue;
      if (behavior.kind === "error") {
        nextErrors[name] = behavior.error;
      } else if (
        typeof behavior.returns === "object" &&
        behavior.returns !== null &&
        !Array.isArray(behavior.returns)
      ) {
        nextReturns[name] = behavior.returns as Record<string, unknown>;
      }
    }
    setMockReturns(nextReturns);
    for (const [name, err] of Object.entries(nextErrors)) {
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
      buildScenarioFromBuffer(loadedScenario.id, loadedScenario.name ?? ""),
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
    saveScenario(buildScenarioFromBuffer(id, name));
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
      const geminiModel = BUILT_IN_MODELS.default ?? "gemini-2.5-flash";
      // Fill vars first so the mock generator can ground its returns
      // against realistic context (e.g., caller_name matches policyholder).
      const vars = declaredVars.length > 0
        ? await generateContextVars(spec, apiKey, geminiModel, declaredVars)
        : {};
      if (Object.keys(vars).length > 0) setContextVars(vars);
      const mocks = mockableCaps.length > 0
        ? await generateCapabilityMocks(spec, apiKey, geminiModel, mockableCaps, vars)
        : {};
      if (Object.keys(mocks).length > 0) setMockReturns(mocks);
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
      onClear={filledVarsCount > 0 || setMocksCount > 0 ? onClear : undefined}
      onGenerate={onGenerate}
      apiKey={apiKey}
      disabled={disabled}
      generating={generating}
      generateTitle="Use the LLM to fill realistic happy-path vars + mock returns. Mocks are grounded against the generated vars."
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

        {declaredVars.length > 0 && (
          <VarsSection
            declared={declaredVars}
            values={contextVars}
            disabled={disabled || generating}
            onChange={(name, value) => setContextVar(name, value)}
            filledCount={filledVarsCount}
          />
        )}

        {mockableCaps.length > 0 && (
          <MocksSection
            caps={mockableCaps}
            returns={mockReturns}
            errors={mockErrors}
            disabled={disabled || generating}
            onChangeReturn={(capName, outName, v) => setMockOutput(capName, outName, v)}
            onChangeError={(capName, err) => setMockError(capName, err)}
            setMocksCount={setMocksCount}
          />
        )}
      </div>
    </CollapsibleGenerateSection>
  );
}

// ---- Load / save row ----

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

// ---- Vars sub-section ----

interface VarsSectionProps {
  declared: DeclaredVariable[];
  values: Record<string, unknown>;
  disabled: boolean;
  onChange: (name: string, value: unknown) => void;
  filledCount: number;
}

function VarsSection({ declared, values, disabled, onChange, filledCount }: VarsSectionProps) {
  const [open, setOpen] = useState(false);
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
                disabled={disabled}
                onChange={(v) => onChange(d.name, v)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Mocks sub-section ----

interface MocksSectionProps {
  caps: MockableCapability[];
  returns: Record<string, Record<string, unknown>>;
  errors: Record<string, string>;
  disabled: boolean;
  onChangeReturn: (capName: string, outName: string, v: unknown) => void;
  onChangeError: (capName: string, err: string | null) => void;
  setMocksCount: number;
}

function MocksSection({
  caps,
  returns,
  errors,
  disabled,
  onChangeReturn,
  onChangeError,
  setMocksCount,
}: MocksSectionProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-zinc-50"
      >
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          mocks ({setMocksCount}/{caps.length} set)
        </span>
        <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-zinc-100 px-2 py-2">
          {caps.map((cap) => (
            <CapMockRow
              key={cap.capabilityId}
              cap={cap}
              values={returns[cap.capabilityName] ?? {}}
              error={errors[cap.capabilityName] ?? null}
              disabled={disabled}
              onChangeReturn={(outName, v) =>
                onChangeReturn(cap.capabilityName, outName, v)
              }
              onChangeError={(err) => onChangeError(cap.capabilityName, err)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CapMockRowProps {
  cap: MockableCapability;
  values: Record<string, unknown>;
  error: string | null;
  disabled: boolean;
  onChangeReturn: (outName: string, v: unknown) => void;
  onChangeError: (err: string | null) => void;
}

function CapMockRow({
  cap,
  values,
  error,
  disabled,
  onChangeReturn,
  onChangeError,
}: CapMockRowProps) {
  const [open, setOpen] = useState(false);
  const inErrorMode = error !== null;
  const filledHere = Object.keys(values).filter((k) => values[k] !== undefined).length;
  const subtitle = inErrorMode
    ? "error"
    : cap.outputs.length === 0
      ? "side-effect"
      : `${filledHere}/${cap.outputs.length}`;
  const isSet = inErrorMode || filledHere > 0;

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
          <span className="font-mono text-[10px] text-zinc-500">
            {isSet ? subtitle : "—"}
          </span>
        </button>
        <select
          value={inErrorMode ? "error" : isSet ? "static" : "none"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "none") {
              onChangeError(null);
              for (const outName of Object.keys(values)) {
                onChangeReturn(outName, undefined);
              }
              return;
            }
            if (v === "error") {
              onChangeError("");
              setOpen(true);
              return;
            }
            // static
            onChangeError(null);
            setOpen(true);
          }}
          disabled={disabled}
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
      {open && isSet && (
        <div className="space-y-1.5 border-t border-zinc-100 px-2 py-2">
          {inErrorMode ? (
            <input
              type="text"
              value={error ?? ""}
              onChange={(e) => onChangeError(e.target.value)}
              disabled={disabled}
              placeholder="Error message the LLM sees as the tool result"
              className="w-full rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-900 focus:outline-none focus:ring-1 focus:ring-red-400"
            />
          ) : cap.outputs.length === 0 ? (
            <div className="text-[10px] text-zinc-500 italic">
              Capability has no declared outputs (side-effect only); returns = {`{}`}.
            </div>
          ) : (
            cap.outputs.map((out) => (
              <div key={out.name} className="space-y-0.5">
                <label className="block text-[11px] font-mono text-zinc-700">
                  {out.name}
                  {!out.decl && <span className="ml-1 text-zinc-400">· undeclared</span>}
                </label>
                <TypedValueInput
                  decl={out.decl}
                  value={values[out.name]}
                  disabled={disabled}
                  onChange={(v) => onChangeReturn(out.name, v)}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
