import { useMemo, useState } from "react";
import type { Spec, VariableDecl } from "@ux4/core/schema/v0";
import { useSimulateStore } from "@/lib/store/simulate";
import { useSpecStore } from "@/lib/store/spec";
import {
  collectDeclaredVariables,
  unfilledPlaceholders,
  type DeclaredVariable,
} from "@ux4/core/runtime/contextVars";
import { generateContextVars } from "@ux4/core/runtime/contextVarsGen";
import { useSettingsStore } from "@/lib/store/settings";
import { CollapsibleGenerateSection } from "./CollapsibleGenerateSection";
import { TypedValueInput } from "./TypedValueInput";

interface VariablesFormProps {
  spec: Spec;
  disabled: boolean;
}

export function VariablesForm({ spec, disabled }: VariablesFormProps) {
  const declared = useMemo(() => collectDeclaredVariables(spec), [spec]);
  const contextVars = useSimulateStore((s) => s.contextVars);
  const setContextVar = useSimulateStore((s) => s.setContextVar);
  const setContextVars = useSimulateStore((s) => s.setContextVars);
  const clearContextVars = useSimulateStore((s) => s.clearContextVars);
  const apiKey = useSettingsStore((s) => s.googleApiKey);
  const model = useSettingsStore((s) => s.googleModel);
  const updateAgent = useSpecStore((s) => s.updateAgent);

  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  if (declared.length === 0) return null;

  const filledCount = declared.filter((d) => contextVars[d.name] !== undefined).length;
  const declaredLower = new Set(declared.map((d) => d.name.toLowerCase()));
  const undeclaredPlaceholders = unfilledPlaceholders(spec, contextVars).filter(
    (k) => !declaredLower.has(k.toLowerCase()),
  );

  function onDeclareUndeclared() {
    if (undeclaredPlaceholders.length === 0) return;
    const next: Record<string, VariableDecl> = { ...(spec.agent.variables ?? {}) };
    for (const name of undeclaredPlaceholders) {
      if (!next[name]) next[name] = { type: "string" };
    }
    updateAgent({ variables: next });
    setOpen(true);
  }

  async function onGenerate() {
    if (!apiKey) return;
    if (Object.keys(contextVars).length > 0) {
      const ok = window.confirm("Replace existing values with generated ones?");
      if (!ok) return;
    }
    setOpen(true);
    setGenerating(true);
    setGenError(null);
    try {
      const generated = await generateContextVars(spec, apiKey, model, declared);
      setContextVars(generated);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <CollapsibleGenerateSection
      title="Variables"
      countLabel={`(${filledCount} filled / ${declared.length} declared)`}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      onClear={filledCount > 0 ? clearContextVars : undefined}
      onGenerate={onGenerate}
      apiKey={apiKey}
      disabled={disabled}
      generating={generating}
      generateTitle="Use the LLM to fill realistic, coherent values for all declared variables."
    >
      <div className="space-y-3 px-4 pb-6">
        {genError && (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
            {genError}
          </div>
        )}

        <div className="space-y-1">
          {declared.map((d) => (
            <VariableRow
              key={d.name}
              decl={d}
              value={contextVars[d.name]}
              disabled={disabled || generating}
              onChange={(v) => setContextVar(d.name, v)}
            />
          ))}
        </div>

        {undeclaredPlaceholders.length > 0 && (
          <div className="space-y-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
            <p className="text-[11px] text-amber-800">
              Prompt references {"{"}
              {undeclaredPlaceholders.slice(0, 4).join("}, {")}
              {"}"}
              {undeclaredPlaceholders.length > 4
                ? `, +${undeclaredPlaceholders.length - 4} more`
                : ""}{" "}
              but they aren&rsquo;t declared as variables — the agent will emit them as literals.
            </p>
            <button
              type="button"
              onClick={onDeclareUndeclared}
              className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-800 hover:bg-amber-100"
              title="Add these placeholders to agent.variables (type: string) so they travel with the spec."
            >
              Declare as variables
            </button>
          </div>
        )}
      </div>
    </CollapsibleGenerateSection>
  );
}

interface RowProps {
  decl: DeclaredVariable;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}

function VariableRow({ decl, value, disabled, onChange }: RowProps) {
  const { name, decl: v } = decl;
  return (
    <div className="space-y-0.5">
      <label className="block text-[11px] font-mono text-zinc-700">
        {name}
        {decl.scope === "flow" && (
          <span className="ml-1 text-zinc-400">· flow {decl.flowId}</span>
        )}
      </label>
      <TypedValueInput decl={v} value={value} disabled={disabled} onChange={onChange} />
      {v.description && (
        <p className="text-[10px] text-zinc-500">{v.description}</p>
      )}
    </div>
  );
}
