import { useMemo, useState } from "react";
import type { Spec } from "@ux4/core/schema/v0";
import { useSimulateStore } from "@/lib/store/simulate";
import {
  collectMockableCapabilities,
  type MockableCapability,
  type MockableOutput,
} from "@ux4/core/runtime/capabilityMocks";
import { generateCapabilityMocks } from "@ux4/core/runtime/capabilityMocksGen";
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
  const clearMockReturnsForCapability = useSimulateStore(
    (s) => s.clearMockReturnsForCapability,
  );
  const clearMockReturns = useSimulateStore((s) => s.clearMockReturns);
  const apiKey = useSettingsStore((s) => s.googleApiKey);
  const model = useSettingsStore((s) => s.googleModel);

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
      const generated = await generateCapabilityMocks(
        spec,
        apiKey,
        model,
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
      onClear={filledCount > 0 ? clearMockReturns : undefined}
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

        {capabilities.map((cap) => (
          <CapabilityBlock
            key={cap.capabilityName}
            cap={cap}
            values={mockReturns[cap.capabilityName] ?? {}}
            disabled={disabled || generating}
            onChange={(outName, v) => setMockOutput(cap.capabilityName, outName, v)}
            onClear={() => clearMockReturnsForCapability(cap.capabilityName)}
          />
        ))}
      </div>
    </CollapsibleGenerateSection>
  );
}

interface CapabilityBlockProps {
  cap: MockableCapability;
  values: Record<string, unknown>;
  disabled: boolean;
  onChange: (outputName: string, value: unknown) => void;
  onClear: () => void;
}

function CapabilityBlock({ cap, values, disabled, onChange, onClear }: CapabilityBlockProps) {
  const filledHere = Object.keys(values).filter((k) => values[k] !== undefined).length;

  return (
    <div className="rounded border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-100 px-2 py-1.5">
        <div className="min-w-0">
          <div className="text-[11px] font-mono text-zinc-800 truncate">{cap.capabilityName}</div>
          {cap.description && (
            <div className="text-[10px] text-zinc-500 leading-tight truncate">
              {cap.description}
            </div>
          )}
        </div>
        {filledHere > 0 && (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="ml-2 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
            title="Clear values for this capability."
          >
            clear
          </button>
        )}
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
