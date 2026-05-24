import { useEffect, useRef, useState } from "react";
import { parse as parseYaml } from "yaml";
import { useSpecStore } from "@/lib/store/spec";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import { validateSpec, formatErrors } from "@ux4/core/validation/ajv";
import { AgentSheet } from "@/components/sheets/AgentSheet";
import { VariablesSheet } from "@/components/sheets/VariablesSheet";
import { GuardrailsSheet } from "@/components/sheets/GuardrailsSheet";
import { BusinessGoalsSheet } from "@/components/sheets/BusinessGoalsSheet";
import { CapabilitiesSheet } from "@/components/sheets/CapabilitiesSheet";
import { KnowledgeSheet } from "@/components/sheets/KnowledgeSheet";
import { GitHubOpenModal } from "@/components/toolbar/GitHubOpenModal";
import { GitHubProjectControls } from "@/components/toolbar/GitHubProjectControls";
import { generateSystemPrompt } from "@ux4/core/codegen/promptGenerator";
import { decomposeSpec, loadProject } from "@ux4/core/files";
import { useCommentsStore } from "@/lib/store/comments";
import type { FileMap } from "@ux4/core/files/types";
import { makeZip, readZip } from "@ux4/core/files/zip";
import {
  applyTranslations,
  previewTranslationsCsv,
  specToTranslationsCsv,
  type ImportPreview,
} from "@ux4/core/codegen/translationsCsv";
import { downloadCsv, sanitizeFilename, useCsvFileInput } from "@/components/sheets/csvIO";

interface ImportExportToolbarProps {
  onOpenSettings: () => void;
}

const buttonClass =
  "rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 disabled:hover:bg-transparent";

const iconButtonClass =
  "rounded-md border border-zinc-200 p-1.5 text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 disabled:hover:bg-transparent";

const menuItemClass =
  "block w-full text-left px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100";

function ClearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function GithubOpenIcon() {
  // Cloud with downward arrow — open from remote.
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

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

// Small dropdown helper: tracks open state, closes on outside click + Escape.
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

// Walk a dropped folder into a FileMap keyed by paths relative to that folder
// (so the top-level folder name is stripped — loadProject expects `agent.json`
// at the root, not `my-project/agent.json`).
async function readDirectoryEntry(root: FileSystemDirectoryEntry): Promise<FileMap> {
  const out: FileMap = {};
  const rootPrefix = root.fullPath.replace(/^\//, "");

  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      const text = await file.text();
      const full = entry.fullPath.replace(/^\//, "");
      const rel = rootPrefix && full.startsWith(rootPrefix + "/")
        ? full.slice(rootPrefix.length + 1)
        : full;
      out[rel] = text;
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns at most ~100 per call — keep calling until empty.
      const children: FileSystemEntry[] = [];
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        children.push(...batch);
      }
      await Promise.all(children.map(walk));
    }
  }

  await walk(root);
  return out;
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ImportExportToolbar({
  onOpenSettings,
}: ImportExportToolbarProps) {
  const spec = useSpecStore((s) => s.spec);
  const setSpec = useSpecStore((s) => s.setSpec);
  const clearGithubProject = useGithubProjectStore((s) => s.clear);
  const [importOpen, setImportOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [openSheet, setOpenSheet] = useState<null | "agent" | "variables" | "guardrails" | "business_goals" | "capabilities" | "knowledge">(null);
  const [error, setError] = useState<string | null>(null);

  // --- Export dropdown -----------------------------------------------------
  const { open: exportOpen, setOpen: setExportOpen, ref: exportAnchorRef } = useDropdown();

  function exportSpecJson() {
    if (!spec) return;
    const name = sanitizeFilename(spec.agent.id || "spec");
    downloadBlob(`${name}.json`, JSON.stringify(spec, null, 2), "application/json");
    setExportOpen(false);
  }

  async function copySystemPrompt() {
    if (!spec) return;
    try {
      await navigator.clipboard.writeText(generateSystemPrompt(spec));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not copy to clipboard.");
    }
    setExportOpen(false);
  }

  async function exportZip() {
    if (!spec) return;
    const name = sanitizeFilename(spec.agent.id || "spec");
    const fileMap = decomposeSpec(spec);
    const blob = await makeZip(fileMap);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  }

  // --- Translations dropdown -----------------------------------------------
  const {
    open: translationsOpen,
    setOpen: setTranslationsOpen,
    ref: translationsAnchorRef,
  } = useDropdown();
  const [translationsPreview, setTranslationsPreview] = useState<ImportPreview | null>(null);

  const translationsImport = useCsvFileInput((text) => {
    if (!spec) return;
    setTranslationsPreview(previewTranslationsCsv(text, spec));
  });

  function exportTranslationsCsv() {
    if (!spec) return;
    const languages = spec.agent.meta.languages ?? [];
    const csv = specToTranslationsCsv(spec, languages.length ? languages : ["EN"]);
    downloadCsv(
      `${sanitizeFilename(spec.agent.id || "spec")}-translations.csv`,
      csv,
    );
    setTranslationsOpen(false);
  }

  function startTranslationsImport() {
    translationsImport.trigger();
    setTranslationsOpen(false);
  }

  function applyTranslationsPreview() {
    if (!translationsPreview || !spec) return;
    setSpec(applyTranslations(spec, translationsPreview.rows));
    setTranslationsPreview(null);
  }

  // --- Spec import ---------------------------------------------------------
  function commitImport(parsed: unknown) {
    const result = validateSpec(parsed);
    if (!result.valid) return formatErrors(result.errors);
    if (spec && !window.confirm("Replace the current spec?")) return null;
    setSpec(result.spec);
    setImportOpen(false);
    return null;
  }

  function clearSpec() {
    if (!window.confirm("Clear the current spec? This cannot be undone.")) return;
    setSpec(null);
    clearGithubProject();
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button onClick={() => setOpenSheet("agent")} disabled={!spec} className={buttonClass}>
          Agent
        </button>
        <button onClick={() => setOpenSheet("variables")} disabled={!spec} className={buttonClass}>
          Variables
        </button>
        <button onClick={() => setOpenSheet("guardrails")} disabled={!spec} className={buttonClass}>
          Guardrails
        </button>
        {import.meta.env.VITE_DEV === "1" && (
          <button onClick={() => setOpenSheet("business_goals")} disabled={!spec} className={buttonClass}>
            Goals
          </button>
        )}
        <button onClick={() => setOpenSheet("capabilities")} disabled={!spec} className={buttonClass}>
          Capabilities
        </button>
        <button onClick={() => setOpenSheet("knowledge")} disabled={!spec} className={buttonClass}>
          Knowledge
        </button>

        {/* Translations dropdown — CSV round-trip for translatable strings. */}
        <div ref={translationsAnchorRef} className="relative">
          <button
            onClick={() => setTranslationsOpen((o) => !o)}
            disabled={!spec}
            className={buttonClass}
          >
            Translations
          </button>
          {translationsOpen && (
            <div className="absolute left-0 top-full mt-1 z-20 min-w-[12rem] rounded-md border border-zinc-200 bg-white shadow-md py-1">
              <button onClick={startTranslationsImport} className={menuItemClass}>
                Import CSV…
              </button>
              <button onClick={exportTranslationsCsv} className={menuItemClass}>
                Export CSV
              </button>
            </div>
          )}
          {translationsImport.input}
        </div>

        <span className="w-px h-5 bg-zinc-200" />
        <button
          onClick={() => { setError(null); setGithubOpen(true); }}
          className={iconButtonClass}
          title="Open a UX4 project from GitHub"
          aria-label="Open from GitHub"
        >
          <GithubOpenIcon />
        </button>
        <GitHubProjectControls />
        <span className="w-px h-5 bg-zinc-200" />
        <button
          onClick={() => { setError(null); setImportOpen(true); }}
          className={iconButtonClass}
          title="Import"
          aria-label="Import"
        >
          <ImportIcon />
        </button>

        {/* Export dropdown — spec JSON + compiled system prompt. */}
        <div ref={exportAnchorRef} className="relative">
          <button
            onClick={() => setExportOpen((o) => !o)}
            disabled={!spec}
            className={iconButtonClass}
            title="Export"
            aria-label="Export"
          >
            <ExportIcon />
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 min-w-[14rem] rounded-md border border-zinc-200 bg-white shadow-md py-1">
              <button onClick={exportSpecJson} className={menuItemClass}>
                Export JSON
              </button>
              <button onClick={exportZip} className={menuItemClass}>
                Export ZIP (decomposed)
              </button>
              <button onClick={copySystemPrompt} className={menuItemClass}>
                Copy System Prompt
              </button>
            </div>
          )}
        </div>

        <button
          onClick={clearSpec}
          disabled={!spec}
          className={iconButtonClass}
          title="Clear current spec"
          aria-label="Clear current spec"
        >
          <ClearIcon />
        </button>

        <span className="w-px h-5 bg-zinc-200" />
        <button
          onClick={onOpenSettings}
          className={iconButtonClass}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon />
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
      {githubOpen && (
        <GitHubOpenModal
          onClose={() => setGithubOpen(false)}
          onOpenSettings={() => {
            setGithubOpen(false);
            onOpenSettings();
          }}
        />
      )}
      {translationsPreview && spec && (
        <TranslationsImportPreviewModal
          preview={translationsPreview}
          declared={spec.agent.meta.languages ?? []}
          onCancel={() => setTranslationsPreview(null)}
          onApply={applyTranslationsPreview}
        />
      )}
      {openSheet === "agent" && <AgentSheet onClose={() => setOpenSheet(null)} />}
      {openSheet === "variables" && <VariablesSheet onClose={() => setOpenSheet(null)} />}
      {openSheet === "guardrails" && <GuardrailsSheet onClose={() => setOpenSheet(null)} />}
      {openSheet === "business_goals" && <BusinessGoalsSheet onClose={() => setOpenSheet(null)} />}
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
  const folderInputRef = useRef<HTMLInputElement>(null);

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

  function loadFileMap(files: FileMap, emptyMessage: string) {
    const { spec, comments, errors: loadErrors } = loadProject(files);
    if (!spec) {
      setErrors(
        loadErrors.length > 0
          ? loadErrors.map((e) => `${e.path ? e.path + ": " : ""}${e.message}`)
          : [emptyMessage],
      );
      return;
    }
    useCommentsStore.getState().setAll(comments);
    handleParsed(spec);
  }

  function readFile(file: File) {
    const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip";
    if (isZip) {
      readZip(file)
        .then((files) => loadFileMap(files, "No UX4 project found in the ZIP."))
        .catch((e: unknown) => {
          setErrors([e instanceof Error ? e.message : "Could not read the ZIP."]);
        });
      return;
    }
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

  // Folder picker uses webkitdirectory: the input yields a flat FileList whose
  // entries carry `webkitRelativePath` like "my-project/agent.json". Strip the
  // top-level folder name so loadProject sees `agent.json` at the root.
  async function onFolder(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) {
      e.target.value = "";
      return;
    }
    const files: FileMap = {};
    const first = fileList[0].webkitRelativePath;
    const rootPrefix = first.includes("/") ? first.slice(0, first.indexOf("/") + 1) : "";
    try {
      await Promise.all(
        Array.from(fileList).map(async (f) => {
          const rel = rootPrefix && f.webkitRelativePath.startsWith(rootPrefix)
            ? f.webkitRelativePath.slice(rootPrefix.length)
            : f.webkitRelativePath || f.name;
          files[rel] = await f.text();
        }),
      );
      loadFileMap(files, "No UX4 project found in the folder.");
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Could not read the folder."]);
    }
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const items = Array.from(e.dataTransfer.items ?? []);
    const entries = items
      .map((it) => (typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null))
      .filter((e): e is FileSystemEntry => !!e);
    const dir = entries.find((entry) => entry.isDirectory) as FileSystemDirectoryEntry | undefined;
    if (dir) {
      readDirectoryEntry(dir)
        .then((files) => loadFileMap(files, "No UX4 project found in the folder."))
        .catch((err: unknown) => {
          setErrors([err instanceof Error ? err.message : "Could not read the folder."]);
        });
      return;
    }
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
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 transition-colors ${
              dragOver
                ? "border-zinc-700 bg-zinc-50"
                : "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50"
            }`}
          >
            <span className="text-sm font-medium text-zinc-700">
              Drop a file or folder here
            </span>
            <span className="text-[11px] text-zinc-500">.json, .yaml, .yml, .zip — or a decomposed project folder</span>
            <div className="flex gap-2 pt-1">
              <label className="cursor-pointer rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100">
                Choose file…
                <input
                  type="file"
                  accept=".json,.yaml,.yml,.zip,application/json,text/yaml,application/zip"
                  onChange={onFile}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Choose folder…
              </button>
              <input
                ref={folderInputRef}
                type="file"
                onChange={onFolder}
                className="hidden"
                // webkitdirectory is non-standard; React types don't know about
                // it, hence the lowercase string attr + ts-expect-error.
                // @ts-expect-error - webkitdirectory is not in React's input types
                webkitdirectory=""
                directory=""
              />
            </div>
          </div>
          <div className="text-xs text-zinc-400 text-center">— or —</div>
          <div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full h-56 rounded border border-zinc-300 p-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
              placeholder="Paste JSON or YAML…"
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={onPasteCommit}
                disabled={!text.trim()}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
              >
                Parse &amp; import
              </button>
            </div>
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

interface TranslationsImportPreviewModalProps {
  preview: ImportPreview;
  declared: string[];
  onCancel: () => void;
  onApply: () => void;
}

function TranslationsImportPreviewModal({
  preview,
  declared,
  onCancel,
  onApply,
}: TranslationsImportPreviewModalProps) {
  const undeclared = preview.csvLanguages.filter((l) => !declared.includes(l));

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold">Import translations</h3>

        <dl className="text-xs space-y-1">
          <div>
            <dt className="inline font-medium text-zinc-700">CSV languages:</dt>{" "}
            <dd className="inline text-zinc-600">
              {preview.csvLanguages.join(", ") || "(none)"}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-zinc-700">Declared on agent:</dt>{" "}
            <dd className="inline text-zinc-600">{declared.join(", ") || "(none)"}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-zinc-700">Translations to apply:</dt>{" "}
            <dd className="inline text-zinc-600">{preview.matched}</dd>
          </div>
          {preview.unmatched.length > 0 && (
            <div>
              <dt className="font-medium text-zinc-700">
                Translations skipped (key not in spec):
              </dt>
              <dd className="mt-1 text-zinc-600 font-mono text-[11px] max-h-32 overflow-auto rounded bg-zinc-50 border border-zinc-200 p-2">
                {preview.unmatched.map((k) => (
                  <div key={k}>{k}</div>
                ))}
              </dd>
            </div>
          )}
        </dl>

        {undeclared.length > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            <strong>Heads up:</strong> CSV has languages not yet declared on this
            agent: <code>{undeclared.join(", ")}</code>. Translations will apply,
            but the agent&apos;s declared-languages list isn&apos;t modified by
            import. Add them in the Agent sheet if you want them honored across
            the editor and at runtime.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            onClick={onApply}
            disabled={preview.matched === 0}
            className="rounded-md border border-zinc-200 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

