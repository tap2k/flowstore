import { useMemo, useState } from "react";
import type { Spec } from "@flowstore/core/schema/v0";
import type { CapabilityMock } from "@flowstore/core/schema/files/capabilityMock";
import { useSimulateStore } from "@/lib/store/simulate";
import { useTestsStore } from "@/lib/store/tests";
import {
  collectMockableCapabilities,
  type MockableCapability,
  type MockableOutput,
} from "@flowstore/core/runtime/capabilityMocks";
import { generateCapabilityMocks } from "@flowstore/core/runtime/capabilityMocksGen";
import { BUILT_IN_MODELS } from "@flowstore/core/files/models";
import { useSettingsStore } from "@/lib/store/settings";
import { CollapsibleGenerateSection } from "./CollapsibleGenerateSection";
import { TypedValueInput } from "./TypedValueInput";

interface CapabilityMocksFormProps {
  spec: Spec;
  disabled: boolean;
}

export function CapabilityMocksForm({ spec, disabled }: CapabilityMocksFormProps) {
  const capabilities = useMemo(() => collectMockableCapabilities(spec), [spec]);
  const mockReturns = useSimulateStore((s) => s.mockReturns);
  const contextVars = useSimulateStore((s) => s.contextVars);
  const setMockOutput = useSimulateStore((s) => s.setMockOutput);
  const setMockReturns = useSimulateStore((s) => s.setMockReturns);
  const clearMockReturns = useSimulateStore((s) => s.clearMockReturns);
  const mocksByCapability = useTestsStore((s) => s.mocksByCapability);
  const saveCapabilityMock = useTestsStore((s) => s.saveCapabilityMock);
  const deleteCapabilityMock = useTestsStore((s) => s.deleteCapabilityMock);
  const uniqueMockVariant = useTestsStore((s) => s.uniqueMockVariant);
  // Tracks which saved variant the current values were loaded from,
  // per capability id. Cleared on Clear / Generate / load none.
  const [loadedVariantByCap, setLoadedVariantByCap] = useState<Record<string, string>>({});
  // Inline save-as: { [capability_id]: in-progress-name }. Replaces a
  // window.prompt with the same pattern VariablesForm uses.
  const [savingAsByCap, setSavingAsByCap] = useState<Record<string, string>>({});
  // ✨ Generate uses Gemini structured output (responseSchema) — Google-only.
  // Force a Gemini model regardless of the chatModel picker.
  const apiKey = useSettingsStore((s) => s.googleApiKey);

  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  if (capabilities.length === 0) return null;

  const filledCount = capabilities.filter(
    (c) => Object.keys(mockReturns[c.capabilityName] ?? {}).length > 0,
  ).length;

  async function onGenerate() {
    if (!apiKey) return;
    if (filledCount > 0) {
      const ok = window.confirm("Replace existing mock values with generated ones?");
      if (!ok) return;
    }
    setOpen(true);
    setGenerating(true);
    setGenError(null);
    try {
      const geminiModel = BUILT_IN_MODELS.default ?? "gemini-2.5-flash";
      const generated = await generateCapabilityMocks(
        spec,
        apiKey,
        geminiModel,
        capabilities,
        contextVars,
      );
      setMockReturns(generated);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <CollapsibleGenerateSection
      title="Capabilities"
      countLabel={`(${filledCount} filled / ${capabilities.length} declared)`}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      onClear={
        filledCount > 0
          ? () => {
              clearMockReturns();
              setLoadedVariantByCap({});
            }
          : undefined
      }
      onGenerate={onGenerate}
      apiKey={apiKey}
      disabled={disabled}
      generating={generating}
      generateTitle="Use the LLM to fill realistic happy-path return values for all capability outputs."
    >
      <div className="space-y-3 px-4 pb-4">
        {genError && (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
            {genError}
          </div>
        )}

        {capabilities.map((cap) => {
          const savedForCap = (mocksByCapability[cap.capabilityId] ?? []).filter(
            (m) => m.behavior.kind === "static",
          );
          const loadedVariant = loadedVariantByCap[cap.capabilityId] ?? null;
          const savingAsName = savingAsByCap[cap.capabilityId] ?? null;
          const currentValues = mockReturns[cap.capabilityName] ?? {};
          return (
            <CapabilityBlock
              key={cap.capabilityName}
              cap={cap}
              values={currentValues}
              savedMocks={savedForCap}
              loadedVariant={loadedVariant}
              savingAsName={savingAsName}
              disabled={disabled || generating}
              onChange={(outName, v) => {
                setMockOutput(cap.capabilityName, outName, v);
              }}
              onLoadSaved={(mock) => {
                if (mock.behavior.kind !== "static") return;
                const returns = mock.behavior.returns;
                if (typeof returns !== "object" || returns === null) return;
                setMockReturns({
                  ...mockReturns,
                  [cap.capabilityName]: returns as Record<string, unknown>,
                });
                setLoadedVariantByCap({
                  ...loadedVariantByCap,
                  [cap.capabilityId]: mock.variant,
                });
              }}
              onSave={() => {
                if (!loadedVariant) return;
                saveCapabilityMock({
                  $schema: "flowstore://test/mock/v0",
                  capability_id: cap.capabilityId,
                  variant: loadedVariant,
                  behavior: { kind: "static", returns: currentValues },
                });
              }}
              onStartSaveAs={() => {
                const defaultName = uniqueMockVariant(
                  cap.capabilityId,
                  loadedVariant ?? "happy",
                );
                setSavingAsByCap({ ...savingAsByCap, [cap.capabilityId]: defaultName });
              }}
              onChangeSaveAsName={(name) => {
                setSavingAsByCap({ ...savingAsByCap, [cap.capabilityId]: name });
              }}
              onCommitSaveAs={() => {
                const name = (savingAsName ?? "").trim();
                if (name === "") return;
                saveCapabilityMock({
                  $schema: "flowstore://test/mock/v0",
                  capability_id: cap.capabilityId,
                  variant: name,
                  behavior: { kind: "static", returns: currentValues },
                });
                setLoadedVariantByCap({
                  ...loadedVariantByCap,
                  [cap.capabilityId]: name,
                });
                const nextSavingAs = { ...savingAsByCap };
                delete nextSavingAs[cap.capabilityId];
                setSavingAsByCap(nextSavingAs);
              }}
              onCancelSaveAs={() => {
                const next = { ...savingAsByCap };
                delete next[cap.capabilityId];
                setSavingAsByCap(next);
              }}
              onDelete={() => {
                if (!loadedVariant) return;
                const ok = window.confirm(
                  `Delete mock "${cap.capabilityId}.${loadedVariant}"? Cases binding it will lose the binding.`,
                );
                if (!ok) return;
                deleteCapabilityMock(cap.capabilityId, loadedVariant);
                const next = { ...loadedVariantByCap };
                delete next[cap.capabilityId];
                setLoadedVariantByCap(next);
              }}
            />
          );
        })}
      </div>
    </CollapsibleGenerateSection>
  );
}

interface CapabilityBlockProps {
  cap: MockableCapability;
  values: Record<string, unknown>;
  savedMocks: CapabilityMock[];
  loadedVariant: string | null;
  savingAsName: string | null;
  disabled: boolean;
  onChange: (outputName: string, value: unknown) => void;
  onLoadSaved: (mock: CapabilityMock) => void;
  onSave: () => void;
  onStartSaveAs: () => void;
  onChangeSaveAsName: (name: string) => void;
  onCommitSaveAs: () => void;
  onCancelSaveAs: () => void;
  onDelete: () => void;
}

function CapabilityBlock({
  cap,
  values,
  savedMocks,
  loadedVariant,
  savingAsName,
  disabled,
  onChange,
  onLoadSaved,
  onSave,
  onStartSaveAs,
  onChangeSaveAsName,
  onCommitSaveAs,
  onCancelSaveAs,
  onDelete,
}: CapabilityBlockProps) {
  const filledHere = Object.keys(values).filter((k) => values[k] !== undefined).length;

  return (
    <div className="rounded border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 px-2 py-1.5 space-y-1">
        <div className="text-[11px] font-mono text-zinc-800 truncate">
          {cap.capabilityName}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {savedMocks.length > 0 && (
            <select
              value={loadedVariant ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") return;
                const m = savedMocks.find((mock) => mock.variant === v);
                if (m) onLoadSaved(m);
              }}
              disabled={disabled}
              title="Hydrate this capability's mock returns from a saved file."
              className="max-w-[7rem] truncate rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
            >
              <option value="">load saved…</option>
              {savedMocks.map((m) => (
                <option
                  key={m.variant}
                  value={m.variant}
                  title={m.description}
                >
                  {m.variant}
                </option>
              ))}
            </select>
          )}
          {loadedVariant && (
            <button
              type="button"
              onClick={onSave}
              disabled={disabled}
              title={`Update capabilities/${cap.capabilityId}.${loadedVariant}.mock.json with current values.`}
              className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
            >
              save
            </button>
          )}
          {savingAsName === null ? (
            filledHere > 0 && (
              <button
                type="button"
                onClick={onStartSaveAs}
                disabled={disabled}
                title="Save current values as a new mock variant for this capability."
                className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
              >
                save as…
              </button>
            )
          ) : (
            <>
              <input
                type="text"
                autoFocus
                value={savingAsName}
                onChange={(e) => onChangeSaveAsName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCommitSaveAs();
                  else if (e.key === "Escape") onCancelSaveAs();
                }}
                placeholder="variant"
                className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] font-mono text-zinc-800"
                style={{ width: "5rem" }}
              />
              <button
                type="button"
                onClick={onCancelSaveAs}
                className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={onCommitSaveAs}
                disabled={savingAsName.trim() === ""}
                className="rounded-md bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
              >
                save
              </button>
            </>
          )}
          {loadedVariant && (
            <button
              type="button"
              onClick={onDelete}
              disabled={disabled}
              title={`Delete capabilities/${cap.capabilityId}.${loadedVariant}.mock.json (cascade-strips case bindings).`}
              className="rounded border border-red-300 bg-white px-1.5 py-0.5 text-[10px] text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              delete
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2 px-2 py-2">
        {cap.outputs.map((out) => (
          <OutputRow
            key={out.name}
            output={out}
            value={values[out.name]}
            disabled={disabled}
            onChange={(v) => onChange(out.name, v)}
          />
        ))}
      </div>
    </div>
  );
}

interface OutputRowProps {
  output: MockableOutput;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}

function OutputRow({ output, value, disabled, onChange }: OutputRowProps) {
  const { name, decl } = output;
  return (
    <div className="space-y-0.5">
      <label className="block text-[11px] font-mono text-zinc-700">
        {name}
        {!decl && <span className="ml-1 text-zinc-400">· undeclared</span>}
      </label>
      <TypedValueInput decl={decl} value={value} disabled={disabled} onChange={onChange} />
      {decl?.description && (
        <p className="text-[10px] text-zinc-500">{decl.description}</p>
      )}
    </div>
  );
}
