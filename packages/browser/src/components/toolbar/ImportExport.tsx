import { useEffect, useRef, useState } from "react";
import {
  CaretDown,
  CloudArrowDown,
  DownloadSimple,
  FileZip,
  Gear,
  Package,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { parse as parseYaml } from "yaml";
import { useSpecStore } from "@/lib/store/spec";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import { validateSpec, formatErrors } from "@flowstore/core/validation/ajv";
import { AgentSheet } from "@/components/sheets/AgentSheet";
import { VariablesSheet } from "@/components/sheets/VariablesSheet";
import { GuardrailsSheet } from "@/components/sheets/GuardrailsSheet";
import { BusinessGoalsSheet } from "@/components/sheets/BusinessGoalsSheet";
import { CapabilitiesSheet } from "@/components/sheets/CapabilitiesSheet";
import { KnowledgeSheet } from "@/components/sheets/KnowledgeSheet";
import { EndpointsSheet } from "@/components/sheets/EndpointsSheet";
import { GitHubOpenModal } from "@/components/toolbar/GitHubOpenModal";
import { GitHubProjectControls } from "@/components/toolbar/GitHubProjectControls";
import {
  decomposeSpec,
  decomposeTestingArtifacts,
  decomposeComments,
  decomposeModelsConfig,
  loadProject,
} from "@flowstore/core/files";
import { useModelsStore } from "@/lib/store/models";
import { loadPortableSpec, loadSpec, type LoadSpecOptions } from "@/lib/store/loadSpec";
import { useCommentsStore } from "@/lib/store/comments";
import { useTestsStore } from "@/lib/store/tests";
import { useUiStore } from "@/lib/store/ui";
import type { FileMap } from "@flowstore/core/files/types";
import { makeZip, readZip } from "@flowstore/core/files/zip";
import { isFileMapBundle } from "@flowstore/core/files/load";
import {
  applyTranslations,
  previewTranslationsCsv,
  specToTranslationsCsv,
  type ImportPreview,
} from "@flowstore/core/codegen/translationsCsv";
import { downloadCsv, sanitizeFilename, useCsvFileInput } from "@/components/sheets/csvIO";
import { Button, Dialog, DropdownMenu, IconButton, Textarea } from "@/components/ui";

interface ImportExportToolbarProps {
  onOpenSettings: () => void;
  onSaveToGitHub: () => void;
  onShare: () => void;
}

// Vertical rule between toolbar groups. Border token, not a filled bar — a
// separator must never read as heavy as a control.
function Divider() {
  return <span className="mx-1 h-5 w-px bg-border-subtle" />;
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

// Open state + Escape for the toolbar's dropdowns. Outside-click dismissal is
// the DropdownMenu atom's job (it renders a full-viewport click catcher), so
// this no longer needs an anchor ref of its own.
function useDropdown() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return { open, setOpen };
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
  onSaveToGitHub,
  onShare,
}: ImportExportToolbarProps) {
  const spec = useSpecStore((s) => s.spec);
  const setSpec = useSpecStore((s) => s.setSpec);
  const clearGithubProject = useGithubProjectStore((s) => s.clear);
  const [importOpen, setImportOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  // Sheet-open state lives in the ui store so the Prompt panel can open sheets too.
  const openSheet = useUiStore((s) => s.openSheet);
  const setOpenSheet = useUiStore((s) => s.setOpenSheet);
  const [error, setError] = useState<string | null>(null);

  // --- Export dropdown -----------------------------------------------------
  const { open: exportOpen, setOpen: setExportOpen } = useDropdown();

  function projectFileMap(): FileMap {
    if (!spec) return {};
    return {
      ...decomposeSpec(spec),
      ...decomposeTestingArtifacts(useTestsStore.getState().toTestingArtifacts()),
      ...decomposeModelsConfig(useModelsStore.getState().config),
      // Comments too — a ZIP/bundle is the complete project archive (and
      // import reads them back), unlike GitHub which writes comment files on
      // authoring.
      ...decomposeComments(useCommentsStore.getState().comments),
    };
  }

  // Single-file bundle: the FileMap itself as JSON. Interchange only — it is
  // generated from and expanded back to the file model, never a second
  // canonical form. Same shape compare exports and uploads.
  function exportBundle() {
    if (!spec) return;
    const name = sanitizeFilename(spec.agent.id || "spec");
    downloadBlob(
      `${name}.flowstore.json`,
      JSON.stringify(projectFileMap(), null, 2),
      "application/json",
    );
    setExportOpen(false);
  }

  async function exportZip() {
    if (!spec) return;
    const name = sanitizeFilename(spec.agent.id || "spec");
    const fileMap = projectFileMap();
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
  const { open: translationsOpen, setOpen: setTranslationsOpen } = useDropdown();
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
  // opts carries testing artifacts + comments for project-backed imports
  // (ZIP/folder); a bare JSON import omits them so loadSpec clears the prior
  // spec's tests/comments rather than letting them orphan onto the new spec.
  function commitImport(parsed: unknown, opts?: LoadSpecOptions) {
    const result = validateSpec(parsed);
    if (!result.valid) return formatErrors(result.errors);
    // Portable-artifact policy (confirm + load + drop the GitHub claim)
    // lives in loadPortableSpec, shared with the compare handoff drain.
    if (loadPortableSpec(result.spec, opts)) setImportOpen(false);
    return null;
  }

  function clearSpec() {
    if (!window.confirm("Clear the current spec? This cannot be undone.")) return;
    loadSpec(null);
    clearGithubProject();
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {/* Spec sections. Ghost, because none of them is the primary action —
            they open editors, they don't commit anything. */}
        <Button variant="ghost" onClick={() => setOpenSheet("agent")} disabled={!spec}>
          Agent
        </Button>
        <Button variant="ghost" onClick={() => setOpenSheet("variables")} disabled={!spec}>
          Variables
        </Button>
        <Button variant="ghost" onClick={() => setOpenSheet("guardrails")} disabled={!spec}>
          Guardrails
        </Button>
        {import.meta.env.VITE_DEV === "1" && (
          <Button variant="ghost" onClick={() => setOpenSheet("business_goals")} disabled={!spec}>
            Goals
          </Button>
        )}
        <Button variant="ghost" onClick={() => setOpenSheet("capabilities")} disabled={!spec}>
          Capabilities
        </Button>
        <Button variant="ghost" onClick={() => setOpenSheet("knowledge")} disabled={!spec}>
          Knowledge
        </Button>
        {import.meta.env.VITE_DEV === "1" && (
          <Button variant="ghost" onClick={() => setOpenSheet("endpoints")}>
            Endpoints
          </Button>
        )}

        {/* Translations dropdown — CSV round-trip for translatable strings. */}
        <DropdownMenu
          open={translationsOpen}
          onOpenChange={setTranslationsOpen}
          trigger={
            <Button variant="ghost" iconRight={CaretDown} disabled={!spec}>
              Translations
            </Button>
          }
          items={[
            { label: "Import CSV…", icon: UploadSimple, onSelect: startTranslationsImport },
            { label: "Export CSV", icon: DownloadSimple, onSelect: exportTranslationsCsv },
          ]}
        />
        {translationsImport.input}

        <Divider />
        <IconButton
          icon={CloudArrowDown}
          label="Open a flowstore project from GitHub"
          onClick={() => {
            setError(null);
            setGithubOpen(true);
          }}
        />
        <GitHubProjectControls onSaveToGitHub={onSaveToGitHub} onShare={onShare} />
        <Divider />
        <IconButton
          icon={UploadSimple}
          label="Import"
          onClick={() => {
            setError(null);
            setImportOpen(true);
          }}
        />

        {/* Export dropdown — the project as one .flowstore.json or a ZIP. */}
        <DropdownMenu
          align="right"
          open={exportOpen}
          onOpenChange={setExportOpen}
          trigger={<IconButton icon={DownloadSimple} label="Export" disabled={!spec} />}
          items={[
            { label: "Export project (.flowstore.json)", icon: Package, onSelect: exportBundle },
            { label: "Export ZIP", icon: FileZip, onSelect: exportZip },
          ]}
        />

        <IconButton icon={Trash} label="Clear current spec" disabled={!spec} onClick={clearSpec} />

        <Divider />
        <IconButton icon={Gear} label="Settings" onClick={onOpenSettings} />
      </div>
      {error && (
        <div className="fs-ui mt-2 flex items-center gap-2 rounded-2 border border-state-error-line bg-state-error-bg px-3 py-1.5 text-state-error-fg">
          {error}
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>
            Dismiss
          </Button>
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
      {openSheet === "endpoints" && <EndpointsSheet onClose={() => setOpenSheet(null)} />}
    </>
  );
}

interface ImportModalProps {
  onClose: () => void;
  onCommit: (parsed: unknown, opts?: LoadSpecOptions) => string[] | null;
}

function ImportModal({ onClose, onCommit }: ImportModalProps) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  function handleParsed(data: unknown, opts?: LoadSpecOptions) {
    // A single-file bundle routes through the project loader like a ZIP or
    // folder would — it IS the file model, serialized.
    if (isFileMapBundle(data)) {
      loadFileMap(data, "No flowstore project found in the bundle.");
      return;
    }
    setErrors([]);
    const result = onCommit(data, opts);
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
    const { spec, comments, testingArtifacts, errors: loadErrors, modelsConfig } = loadProject(files);
    if (!spec) {
      setErrors(
        loadErrors.length > 0
          ? loadErrors.map((e) => `${e.path ? e.path + ": " : ""}${e.message}`)
          : [emptyMessage],
      );
      return;
    }
    // Project-backed import: hand the artifacts + comments + endpoints to
    // loadSpec so they replace whatever was loaded before.
    handleParsed(spec, { testingArtifacts, comments, modelsConfig });
  }

  function readFile(file: File) {
    const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip";
    if (isZip) {
      readZip(file)
        .then((files) => loadFileMap(files, "No flowstore project found in the ZIP."))
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
      loadFileMap(files, "No flowstore project found in the folder.");
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
        .then((files) => loadFileMap(files, "No flowstore project found in the folder."))
        .catch((err: unknown) => {
          setErrors([err instanceof Error ? err.message : "Could not read the folder."]);
        });
      return;
    }
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  }

  return (
    <Dialog
      open
      title="Import spec"
      width={672}
      onClose={onClose}
      footer={
        <Button variant="primary" size="lg" onClick={onPasteCommit} disabled={!text.trim()}>
          Parse &amp; import
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-2 rounded-3 border-2 border-dashed px-4 py-8 transition-colors ${
            dragOver
              ? "border-border-strong bg-surface-sunken"
              : "border-border-default hover:border-border-strong hover:bg-surface-hover"
          }`}
        >
          <span className="fs-control text-text-secondary">Drop a file or folder here</span>
          <span className="fs-caption text-text-tertiary">
            .json, .yaml, .yml, .zip, .flowstore.json bundle — or a decomposed project folder
          </span>
          <div className="flex gap-2 pt-1">
            {/* A label, not a Button: it has to wrap the file input to keep the
                native picker one click away. */}
            <label className="fs-control inline-flex h-7 cursor-pointer items-center rounded-2 border border-border-default bg-surface-panel px-2.5 text-text-primary hover:bg-surface-hover hover:border-border-strong">
              Choose file…
              <input
                type="file"
                accept=".json,.yaml,.yml,.zip,application/json,text/yaml,application/zip"
                onChange={onFile}
                className="hidden"
              />
            </label>
            <Button onClick={() => folderInputRef.current?.click()}>Choose folder…</Button>
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
        <div className="fs-caption text-center text-text-tertiary">— or —</div>
        <Textarea
          code
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-56 w-full"
          placeholder="Paste JSON or YAML…"
        />
        {errors.length > 0 && (
          <div className="max-h-48 overflow-auto rounded-3 border border-state-error-line bg-state-error-bg p-3 text-state-error-fg">
            <div className="fs-control mb-1">
              {errors.length} error{errors.length === 1 ? "" : "s"}
            </div>
            <ul className="fs-data flex list-none flex-col gap-0.5 p-0">
              {errors.slice(0, 30).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {errors.length > 30 && <li>… and {errors.length - 30} more</li>}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
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
    <Dialog
      open
      title="Import translations"
      width={512}
      onClose={onCancel}
      footer={
        <>
          <Button size="lg" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" onClick={onApply} disabled={preview.matched === 0}>
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <dl className="fs-caption m-0 flex flex-col gap-1">
          <div>
            <dt className="fs-label inline text-text-secondary">CSV languages:</dt>{" "}
            <dd className="m-0 inline text-text-primary">
              {preview.csvLanguages.join(", ") || "(none)"}
            </dd>
          </div>
          <div>
            <dt className="fs-label inline text-text-secondary">Declared on agent:</dt>{" "}
            <dd className="m-0 inline text-text-primary">{declared.join(", ") || "(none)"}</dd>
          </div>
          <div>
            <dt className="fs-label inline text-text-secondary">Translations to apply:</dt>{" "}
            <dd className="m-0 inline text-text-primary tabular">{preview.matched}</dd>
          </div>
          {preview.unmatched.length > 0 && (
            <div>
              <dt className="fs-label text-text-secondary">
                Translations skipped (key not in spec):
              </dt>
              <dd className="fs-data m-0 mt-1 max-h-32 overflow-auto rounded-2 border border-border-subtle bg-surface-sunken p-2 text-text-secondary">
                {preview.unmatched.map((k) => (
                  <div key={k}>{k}</div>
                ))}
              </dd>
            </div>
          )}
        </dl>

        {undeclared.length > 0 && (
          <div className="fs-caption rounded-2 border border-state-warning-line bg-state-warning-bg p-2 text-state-warning-fg">
            <strong>Heads up:</strong> CSV has languages not yet declared on this agent:{" "}
            <code>{undeclared.join(", ")}</code>. Translations will apply, but the agent&apos;s
            declared-languages list isn&apos;t modified by import. Add them in the Agent sheet if
            you want them honored across the editor and at runtime.
          </div>
        )}
      </div>
    </Dialog>
  );
}

