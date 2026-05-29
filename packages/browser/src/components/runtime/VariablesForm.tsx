import { useMemo, useState } from "react";
import type { Spec, VariableDecl } from "@flowstore/core/schema/v0";
import { useSimulateStore } from "@/lib/store/simulate";
import { useSpecStore } from "@/lib/store/spec";
import { useTestsStore } from "@/lib/store/tests";
import {
  collectDeclaredVariables,
  unfilledPlaceholders,
  type DeclaredVariable,
} from "@flowstore/core/runtime/contextVars";
import { generateContextVars } from "@flowstore/core/runtime/contextVarsGen";
import { BUILT_IN_MODELS } from "@flowstore/core/files/models";
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
  // ✨ Generate uses Gemini structured output (responseSchema) — Google-only.
  // Force a Gemini model regardless of the chatModel picker.
  const apiKey = useSettingsStore((s) => s.googleApiKey);
  const updateAgent = useSpecStore((s) => s.updateAgent);
  const varsFiles = useTestsStore((s) => s.varsFiles);
  const saveVarsFile = useTestsStore((s) => s.saveVarsFile);
  const deleteVarsFile = useTestsStore((s) => s.deleteVarsFile);
  const uniqueVarsFileName = useTestsStore((s) => s.uniqueVarsFileName);

  // Tracks which saved vars file the buffer was loaded from (or saved
  // as). Cleared when the user clears or generates fresh values.
  const [loadedVarsName, setLoadedVarsName] = useState<string | null>(null);
  // Inline "save as" input: null = not naming; string = the in-progress
  // name. Replaces the modal window.prompt with an in-place text input
  // matching the MocksPanel + New pattern.
  const [savingAsName, setSavingAsName] = useState<string | null>(null);
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

  function onLoadVarsFile(name: string) {
    if (name === "") return;
    const file = varsFiles[name];
    if (!file) return;
    if (filledCount > 0) {
      const ok = window.confirm(`Replace current values with "${name}"?`);
      if (!ok) return;
    }
    setContextVars(file);
    setLoadedVarsName(name);
    setOpen(true);
  }

  function onStartSaveAs() {
    if (filledCount === 0) return;
    setSavingAsName(uniqueVarsFileName(loadedVarsName ?? "vars"));
  }
  function onConfirmSaveAs() {
    if (savingAsName === null) return;
    const name = savingAsName.trim();
    if (name === "") return;
    saveVarsFile(name, contextVars);
    setLoadedVarsName(name);
    setSavingAsName(null);
  }
  function onCancelSaveAs() {
    setSavingAsName(null);
  }

  function onSaveVars() {
    if (!loadedVarsName) return;
    saveVarsFile(loadedVarsName, contextVars);
  }

  function onDeleteVarsFile() {
    if (!loadedVarsName) return;
    const ok = window.confirm(
      `Delete vars file "${loadedVarsName}"? Cases referencing it will lose the binding.`,
    );
    if (!ok) return;
    deleteVarsFile(loadedVarsName);
    setLoadedVarsName(null);
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
      const geminiModel = BUILT_IN_MODELS.default ?? "gemini-2.5-flash";
      const generated = await generateContextVars(spec, apiKey, geminiModel, declared);
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

        <div className="flex flex-wrap items-center gap-1 text-[10px] text-zinc-600">
          <select
            value={loadedVarsName ?? ""}
            onChange={(e) => onLoadVarsFile(e.target.value)}
            disabled={disabled || generating || Object.keys(varsFiles).length === 0}
            className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
          >
            <option value="">
              {Object.keys(varsFiles).length === 0
                ? "no saved vars files"
                : "load saved…"}
            </option>
            {Object.keys(varsFiles)
              .sort()
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
          {loadedVarsName && (
            <button
              type="button"
              onClick={onSaveVars}
              disabled={disabled || generating}
              title={`Update tests/vars.${loadedVarsName}.json with current values.`}
              className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              save
            </button>
          )}
          {savingAsName === null ? (
            <button
              type="button"
              onClick={onStartSaveAs}
              disabled={disabled || generating || filledCount === 0}
              title="Save current values to a new tests/vars.<name>.json file."
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
                onClick={onConfirmSaveAs}
                disabled={savingAsName.trim() === ""}
                className="rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
              >
                save
              </button>
              <button
                type="button"
                onClick={onCancelSaveAs}
                className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
              >
                cancel
              </button>
            </>
          )}
          {loadedVarsName && (
            <button
              type="button"
              onClick={onDeleteVarsFile}
              disabled={disabled || generating}
              title={`Delete tests/vars.${loadedVarsName}.json (cascades to cases that bind it).`}
              className="rounded border border-red-300 bg-white px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              delete
            </button>
          )}
        </div>

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
