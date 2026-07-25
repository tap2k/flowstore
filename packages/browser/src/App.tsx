import { useEffect, useMemo, useState } from "react";
import {
  ClockCounterClockwise,
  Play,
  Sparkle,
  TextAlignLeft,
} from "@phosphor-icons/react";
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
import { SpecChangesModal } from "@/components/toolbar/SpecChangesModal";
import { HistoryPanel } from "@/components/toolbar/HistoryPanel";
import { Badge, Button, IconButton, ThemeToggle } from "@/components/ui";
import { useSpecStore } from "@/lib/store/spec";
import { useUiStore } from "@/lib/store/ui";
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
  const simulateOpen = useUiStore((s) => s.simulateOpen);
  const setSimulateOpen = useUiStore((s) => s.setSimulateOpen);
  const historyOpen = useUiStore((s) => s.historyOpen);
  const setHistoryOpen = useUiStore((s) => s.setHistoryOpen);
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
    document.title = spec ? `flowstore — ${spec.agent.name}` : "flowstore";
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
      <div className="fs-root flex flex-col h-screen bg-surface-canvas">
        <header className="flex items-center gap-4 border-b border-border-default bg-surface-panel px-6 py-3">
          {/* Project identity stays top-left; the flowstore wordmark lives on
              the canvas bottom-left (see BrandMark in Canvas). */}
          {spec ? (
            <div className="flex min-w-0 flex-col">
              <h1 className="fs-sectionTitle truncate text-text-primary">{spec.agent.name}</h1>
              {githubLocation ? (
                <div className="flex items-center gap-1 leading-tight">
                  <a
                    href={`https://github.com/${githubLocation.owner}/${githubLocation.repo}/tree/${githubLocation.ref}`}
                    target="_blank"
                    rel="noreferrer"
                    title={`${githubLocation.owner}/${githubLocation.repo}@${githubLocation.ref}`}
                    className="fs-data truncate text-text-tertiary no-underline hover:text-text-primary"
                  >
                    {githubLocation.owner}/{githubLocation.repo}@{githubLocation.ref}
                  </a>
                  {!githubCanWrite && (
                    <span className="fs-micro shrink-0 text-text-tertiary">· read-only</span>
                  )}
                </div>
              ) : (
                <div className="fs-micro text-text-tertiary">Working locally</div>
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
            {/* Sits after the project actions and before nothing — a preference,
                not a document action, so it gets the far edge of the bar. */}
            <ThemeToggle />
          </div>
        </header>
        <main className="flex flex-1 min-h-0">
          <div className="relative flex-1 min-w-0">
            <Canvas />
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
              {/* These float over the canvas but are app actions, not canvas
                  controls — design-system buttons, not the canvas control set. */}
              {spec && !promptOpen && (
                <Button
                  icon={TextAlignLeft}
                  onClick={() => setPromptOpen(true)}
                  title="Prompt — inspect the compiled system prompt"
                  className="shadow-elev-1"
                >
                  Prompt
                  {diagErrors > 0 ? (
                    <Badge tone="error" className="ml-0.5">
                      {diagErrors}
                    </Badge>
                  ) : diagWarnings > 0 ? (
                    <Badge tone="warning" className="ml-0.5">
                      {diagWarnings}
                    </Badge>
                  ) : null}
                </Button>
              )}
              {spec && (hasLlmKey || runnerUrl) && !simulateOpen && (
                <Button icon={Play} onClick={() => setSimulateOpen(true)} className="shadow-elev-1">
                  Run
                </Button>
              )}
              {import.meta.env.VITE_DEV === "1" && githubLocation && !historyOpen && (
                <Button
                  icon={ClockCounterClockwise}
                  onClick={() => setHistoryOpen(true)}
                  title="Revision history"
                  className="shadow-elev-1"
                >
                  History
                </Button>
              )}
              {hasLlmKey && !chatOpen && (
                <IconButton
                  icon={Sparkle}
                  label="Assistant — describe a spec change in natural language"
                  size="lg"
                  onClick={() => setChatOpen(true)}
                  className="border-transparent bg-emphasis text-emphasis-fg shadow-elev-2 hover:border-transparent hover:bg-emphasis-hover"
                />
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
          <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
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
// relative time stays roughly fresh without per-frame work. The dirty pill
// is a button: clicking it opens a diff of the working copy vs the saved
// version on GitHub.
function SaveStatePill() {
  const spec = useSpecStore((s) => s.spec);
  const isDirty = useDirtyStore((s) => s.isDirty);
  const lastSavedAt = useDirtyStore((s) => s.lastSavedAt);
  const hasProject = useGithubProjectStore((s) => s.location !== null);
  const [showChanges, setShowChanges] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastSavedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [lastSavedAt]);

  if (!spec) return null;
  if (isDirty) {
    // Only offer the diff when there's a GitHub project to compare against;
    // otherwise the pill is just a status indicator.
    const badge = <Badge status="warning">Unsaved changes</Badge>;
    return (
      <>
        {hasProject ? (
          <button
            type="button"
            onClick={() => setShowChanges(true)}
            title="Compare with the saved version on GitHub"
            className="cursor-pointer border-none bg-transparent p-0"
          >
            {badge}
          </button>
        ) : (
          badge
        )}
        {showChanges && <SpecChangesModal onClose={() => setShowChanges(false)} />}
      </>
    );
  }
  if (lastSavedAt) {
    return <span className="fs-caption text-text-tertiary">Saved · {timeAgo(lastSavedAt)}</span>;
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
