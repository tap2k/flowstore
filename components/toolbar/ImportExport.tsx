import { useState } from "react";
import { parse as parseYaml } from "yaml";
import { useSpecStore } from "@/lib/store/spec";
import { validateSpec, formatErrors } from "@/lib/validation/ajv";
import { AgentSheet } from "@/components/sheets/AgentSheet";
import { VariablesSheet } from "@/components/sheets/VariablesSheet";
import { GuardrailsSheet } from "@/components/sheets/GuardrailsSheet";
import { CapabilitiesSheet } from "@/components/sheets/CapabilitiesSheet";
import { KnowledgeSheet } from "@/components/sheets/KnowledgeSheet";

interface ImportExportToolbarProps {
  onOpenSettings: () => void;
}

const buttonClass =
  "rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 disabled:hover:bg-transparent";

function tryParseSpecText(input: string): { ok: true; data: unknown } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Empty input." };
  try {
    return { ok: true, data: JSON.parse(trimmed) };
  } catch {
    // fall through to YAML
  }
  try {
    return { ok: true, data: parseYaml(trimmed) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not parse as JSON or YAML." };
  }
}

export function ImportExportToolbar({
  onOpenSettings,
}: ImportExportToolbarProps) {
  const spec = useSpecStore((s) => s.spec);
  const setSpec = useSpecStore((s) => s.setSpec);
  const [importOpen, setImportOpen] = useState(false);
  const [openSheet, setOpenSheet] = useState<null | "agent" | "variables" | "guardrails" | "capabilities" | "knowledge">(null);
  const [error, setError] = useState<string | null>(null);

  function exportSpec() {
    if (!spec) return;
    const json = JSON.stringify(spec, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.agent.id || "spec"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function commitImport(parsed: unknown) {
    const result = validateSpec(parsed);
    if (!result.valid) return formatErrors(result.errors);
    if (spec && !window.confirm("Replace the current spec?")) return null;
    setSpec(result.spec);
    setImportOpen(false);
    return null;
  }

  const addFlow = useSpecStore((s) => s.addFlow);

  return (
    <>
      <div className="flex items-center gap-2">
        <button onClick={() => addFlow(true)} className={`${buttonClass} bg-zinc-900 !text-white border-zinc-900 hover:bg-zinc-700`}>
          + New flow
        </button>
        <span className="w-px h-5 bg-zinc-200" />
        <button onClick={() => setOpenSheet("agent")} disabled={!spec} className={buttonClass}>
          Agent
        </button>
        <button onClick={() => setOpenSheet("variables")} disabled={!spec} className={buttonClass}>
          Variables
        </button>
        <button onClick={() => setOpenSheet("guardrails")} disabled={!spec} className={buttonClass}>
          Guardrails
        </button>
        <button onClick={() => setOpenSheet("capabilities")} disabled={!spec} className={buttonClass}>
          Capabilities
        </button>
        <button onClick={() => setOpenSheet("knowledge")} disabled={!spec} className={buttonClass}>
          Knowledge
        </button>
        <span className="w-px h-5 bg-zinc-200" />
        <button onClick={() => { setError(null); setImportOpen(true); }} className={buttonClass}>
          Import
        </button>
        <button onClick={exportSpec} disabled={!spec} className={buttonClass}>
          Export
        </button>
        <span className="w-px h-5 bg-zinc-200" />
        <button onClick={onOpenSettings} className={buttonClass}>
          Settings
        </button>
      </div>
      {error && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-600 hover:text-red-900">
            dismiss
          </button>
        </div>
      )}
      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onCommit={commitImport}
        />
      )}
      {openSheet === "agent" && <AgentSheet onClose={() => setOpenSheet(null)} />}
      {openSheet === "variables" && <VariablesSheet onClose={() => setOpenSheet(null)} />}
      {openSheet === "guardrails" && <GuardrailsSheet onClose={() => setOpenSheet(null)} />}
      {openSheet === "capabilities" && <CapabilitiesSheet onClose={() => setOpenSheet(null)} />}
      {openSheet === "knowledge" && <KnowledgeSheet onClose={() => setOpenSheet(null)} />}
    </>
  );
}

interface ImportModalProps {
  onClose: () => void;
  onCommit: (parsed: unknown) => string[] | null;
}

function ImportModal({ onClose, onCommit }: ImportModalProps) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  function handleParsed(data: unknown) {
    setErrors([]);
    const result = onCommit(data);
    if (result) setErrors(result);
  }

  function onPasteCommit() {
    const parsed = tryParseSpecText(text);
    if (!parsed.ok) {
      setErrors([parsed.error]);
      return;
    }
    handleParsed(parsed.data);
  }

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? "");
      const parsed = tryParseSpecText(content);
      if (!parsed.ok) {
        setErrors([parsed.error]);
        return;
      }
      handleParsed(parsed.data);
    };
    reader.readAsText(file);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) readFile(file);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold text-zinc-900">Import spec</h2>
          <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-900">
            close
          </button>
        </div>
        <div className="space-y-4">
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-8 cursor-pointer transition-colors ${
              dragOver
                ? "border-zinc-700 bg-zinc-50"
                : "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50"
            }`}
          >
            <span className="text-sm font-medium text-zinc-700">
              Drop a file here, or click to browse
            </span>
            <span className="text-[11px] text-zinc-500">.json, .yaml, .yml</span>
            <input
              type="file"
              accept=".json,.yaml,.yml,application/json,text/yaml"
              onChange={onFile}
              className="hidden"
            />
          </label>
          <div className="text-xs text-zinc-400 text-center">— or —</div>
          <div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full h-56 rounded border border-zinc-300 p-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
              placeholder="Paste JSON or YAML…"
            />
            <button
              onClick={onPasteCommit}
              disabled={!text.trim()}
              className="mt-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              Parse &amp; import
            </button>
          </div>
        </div>
        {errors.length > 0 && (
          <div className="mt-4 max-h-48 overflow-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <div className="font-medium mb-1">
              {errors.length} error{errors.length === 1 ? "" : "s"}
            </div>
            <ul className="space-y-0.5 font-mono">
              {errors.slice(0, 30).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {errors.length > 30 && <li>… and {errors.length - 30} more</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// Re-export for consumers that want to drop the toolbar into both header and empty state.
export { ImportExportToolbar as default };
