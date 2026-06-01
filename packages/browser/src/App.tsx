import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@/components/canvas/Canvas";
import { FlowInspector } from "@/components/inspector/FlowInspector";
import { EdgeInspector } from "@/components/inspector/EdgeInspector";
import { ImportExportToolbar } from "@/components/toolbar/ImportExport";
import { SettingsSheet } from "@/components/sheets/SettingsSheet";
import { ChatPanel } from "@/components/runtime/ChatPanel";
import { SimulatePanel } from "@/components/runtime/SimulatePanel";
import { SystemPromptPanel } from "@/components/runtime/SystemPromptPanel";
import { SaveToNewRepoModal } from "@/components/toolbar/SaveToNewRepoModal";
import { ShareModal } from "@/components/toolbar/ShareModal";
import { useSpecStore } from "@/lib/store/spec";
import { useSettingsStore } from "@/lib/store/settings";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import { startDirtyTracking, useDirtyStore } from "@/lib/store/dirty";
import { computeDiagnostics, diagnosticCounts } from "@/lib/diagnostics";

export function App() {
  const spec = useSpecStore((s) => s.spec);
  // Any configured LLM provider unlocks the prompt-mode panels (Run in
  // prompt mode + Assistant). Google-only here would have hidden them
  // for OpenAI-only / OpenRouter-only users.
  const hasLlmKey = useSettingsStore(
    (s) => !!(s.googleApiKey || s.openaiApiKey || s.openrouterApiKey),
  );
  const runnerUrl = useSettingsStore((s) => s.runnerUrl);
  const githubLocation = useGithubProjectStore((s) => s.location);
  const githubCanWrite = useGithubProjectStore((s) => s.canWrite);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [saveRepoOpen, setSaveRepoOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { errors: diagErrors, warnings: diagWarnings } = useMemo(
    () => diagnosticCounts(spec ? computeDiagnostics(spec) : []),
    [spec],
  );

  // Each store hydrates itself from localStorage at module-creation time (spec
  // / tests / ui via persist middleware, simulate's active-case binding inline,
  // settings at module load). So by first paint the spec is already restored —
  // no mount-time load step, and dirty tracking can start immediately: the
  // hydrated spec is the baseline, so it won't be miscounted as a user edit.
  useEffect(() => startDirtyTracking(), []);

  // Cmd/Ctrl+S: routes by current state. Connected + writable is handled by
  // GitHubProjectControls (which has access to its own doSave); local /
  // read-only mode opens the save-to-new-repo modal (= "Save a copy" in the
  // read-only case). Both handlers are global window listeners with
  // mutually-exclusive guards, so only one acts per key press.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== "s" && e.key !== "S") return;
      const sp = useSpecStore.getState().spec;
      if (!sp) return;
      const loc = useGithubProjectStore.getState().location;
      const cw = useGithubProjectStore.getState().canWrite;
      if (loc && cw) return; // GitHubProjectControls handles writable mode
      e.preventDefault();
      setSaveRepoOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Native "Leave site?" prompt when there are unsaved edits — last-line
  // crash safety. Browsers ignore custom strings now; the prompt itself is
  // the value.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!useDirtyStore.getState().isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    document.title = spec ? `flowstore — ${spec.agent.meta.name}` : "flowstore";
  }, [spec]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }
      const state = useSpecStore.getState();
      const sel = state.selection;
      if (sel?.kind === "flow") {
        const f = state.spec?.flows.find((x) => x.id === sel.id);
        const name = f?.name ?? sel.id;
        if (window.confirm(`Delete flow "${name}"?`)) state.removeFlow(sel.id);
      } else if (sel?.kind === "edge") {
        if (window.confirm("Delete this exit path?")) state.removeExitPath(sel.flowId, sel.exitPathId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <div className="flex flex-col h-screen bg-zinc-50">
        <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-6 py-3">
          {/* Project identity stays top-left; the flowstore wordmark lives on
              the canvas bottom-left (see BrandMark in Canvas). */}
          {spec ? (
            <div className="flex min-w-0 flex-col">
              <h1 className="truncate text-lg font-semibold leading-tight text-zinc-900">
                {spec.agent.meta.name}
              </h1>
              {githubLocation ? (
                <div className="flex items-center gap-1 leading-tight">
                  <a
                    href={`https://github.com/${githubLocation.owner}/${githubLocation.repo}/tree/${githubLocation.ref}`}
                    target="_blank"
                    rel="noreferrer"
                    title={`${githubLocation.owner}/${githubLocation.repo}@${githubLocation.ref}`}
                    className="truncate font-mono text-[11px] text-zinc-500 hover:text-zinc-900 hover:underline"
                  >
                    {githubLocation.owner}/{githubLocation.repo}@{githubLocation.ref}
                  </a>
                  {!githubCanWrite && (
                    <span className="shrink-0 text-[11px] text-zinc-400">· read-only</span>
                  )}
                </div>
              ) : (
                <div className="text-[11px] leading-tight text-zinc-500">Working locally</div>
              )}
            </div>
          ) : null}
          <div className="ml-auto flex items-center gap-3">
            <SaveStatePill />
            <ImportExportToolbar
              onOpenSettings={() => setSettingsOpen(true)}
              onSaveToGitHub={() => setSaveRepoOpen(true)}
              onShare={() => setShareOpen(true)}
            />
          </div>
        </header>
        <main className="flex flex-1 min-h-0">
          <div className="relative flex-1 min-w-0">
            <Canvas />
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
              {spec && !promptOpen && (
                <button
                  onClick={() => setPromptOpen(true)}
                  title="Prompt — inspect the compiled system prompt"
                  className="flex items-center gap-1.5 rounded-full bg-white border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-900 shadow-sm hover:bg-zinc-50"
                >
                  <PromptIcon />
                  Prompt
                  {diagErrors > 0 && (
                    <span className="ml-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-red-700">
                      {diagErrors}
                    </span>
                  )}
                  {diagErrors === 0 && diagWarnings > 0 && (
                    <span className="ml-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-700">
                      {diagWarnings}
                    </span>
                  )}
                </button>
              )}
              {spec && (hasLlmKey || runnerUrl) && !simulateOpen && (
                <button
                  onClick={() => setSimulateOpen(true)}
                  className="flex items-center gap-1.5 rounded-full bg-white border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-900 shadow-sm hover:bg-zinc-50"
                >
                  <SimulateIcon />
                  Run
                </button>
              )}
              {hasLlmKey && !chatOpen && (
                <button
                  onClick={() => setChatOpen(true)}
                  title="Assistant — describe a spec change in natural language"
                  aria-label="Assistant"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white shadow-md hover:bg-zinc-700"
                >
                  <SparklesIcon />
                </button>
              )}
            </div>
          </div>
          <FlowInspector />
          <EdgeInspector />
          <SystemPromptPanel open={promptOpen} onClose={() => setPromptOpen(false)} />
          <SimulatePanel
            open={simulateOpen}
            onClose={() => setSimulateOpen(false)}
            onOpenSettings={() => {
              setSimulateOpen(false);
              setSettingsOpen(true);
            }}
          />
          <ChatPanel
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            onOpenSettings={() => {
              setChatOpen(false);
              setSettingsOpen(true);
            }}
          />
        </main>
      </div>
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {saveRepoOpen && (
        <SaveToNewRepoModal
          onClose={() => setSaveRepoOpen(false)}
          onOpenSettings={() => {
            setSaveRepoOpen(false);
            setSettingsOpen(true);
          }}
        />
      )}
      {shareOpen && <ShareModal onClose={() => setShareOpen(false)} />}
    </>
  );
}

// Header pill — amber dot + "Unsaved changes" when there's pending work,
// muted "Saved · 12s ago" otherwise. Tick re-renders every 15s so the
// relative time stays roughly fresh without per-frame work.
function SaveStatePill() {
  const spec = useSpecStore((s) => s.spec);
  const isDirty = useDirtyStore((s) => s.isDirty);
  const lastSavedAt = useDirtyStore((s) => s.lastSavedAt);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastSavedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [lastSavedAt]);

  if (!spec) return null;
  if (isDirty) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Unsaved changes
      </span>
    );
  }
  if (lastSavedAt) {
    return (
      <span className="text-[11px] text-zinc-500">
        Saved · {timeAgo(lastSavedAt)}
      </span>
    );
  }
  return null;
}

function timeAgo(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleDateString();
}

function SparklesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
      <path d="M19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75z" />
      <path d="M5 14l.5 1.5L7 16l-1.5.5L5 18l-.5-1.5L3 16l1.5-.5z" />
    </svg>
  );
}

function PromptIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="14" y2="12" />
      <line x1="4" y1="18" x2="18" y2="18" />
    </svg>
  );
}

function SimulateIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}
