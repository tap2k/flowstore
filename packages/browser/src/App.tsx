import { useEffect, useState } from "react";
import { Play } from "@phosphor-icons/react";
import { Canvas } from "@/components/canvas/Canvas";
import { FlowInspector } from "@/components/inspector/FlowInspector";
import { EdgeInspector } from "@/components/inspector/EdgeInspector";
import { ImportExportToolbar } from "@/components/toolbar/ImportExport";
import { SettingsSheet } from "@/components/sheets/SettingsSheet";
import { ChatPanel } from "@/components/runtime/ChatPanel";
import { SimulatePanel } from "@/components/runtime/SimulatePanel";
import { SaveToNewRepoModal } from "@/components/toolbar/SaveToNewRepoModal";
import { ShareModal } from "@/components/toolbar/ShareModal";
import { HistoryPanel } from "@/components/toolbar/HistoryPanel";
import { AppShell } from "@/components/shell/AppShell";
import { LeftRail } from "@/components/shell/LeftRail";
import { LeftPanel } from "@/components/shell/LeftPanel";
import { TopBar } from "@/components/shell/TopBar";
import { Button } from "@/components/ui";
import { useSpecStore } from "@/lib/store/spec";
import { useUiStore } from "@/lib/store/ui";
import { useSettingsStore } from "@/lib/store/settings";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import { startDirtyTracking, useDirtyStore } from "@/lib/store/dirty";

export function App() {
  const spec = useSpecStore((s) => s.spec);
  // Any configured LLM provider unlocks the prompt-mode panels (Run in
  // prompt mode + Assistant). Google-only here would have hidden them
  // for OpenAI-only / OpenRouter-only users.
  const hasLlmKey = useSettingsStore(
    (s) => !!(s.googleApiKey || s.openaiApiKey || s.openrouterApiKey),
  );
  const runnerUrl = useSettingsStore((s) => s.runnerUrl);
  const selection = useSpecStore((s) => s.selection);
  const leftTab = useUiStore((s) => s.leftTab);
  const simulateOpen = useUiStore((s) => s.simulateOpen);
  const setSimulateOpen = useUiStore((s) => s.setSimulateOpen);
  const chatOpen = useUiStore((s) => s.chatOpen);
  const setChatOpen = useUiStore((s) => s.setChatOpen);
  const historyOpen = useUiStore((s) => s.historyOpen);
  const setHistoryOpen = useUiStore((s) => s.setHistoryOpen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveRepoOpen, setSaveRepoOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Node controls are selection-driven — there is no separate open state, the
  // selection IS the open state. Counted here with the other three because the
  // canvas-collapse rule cares about how much width is spoken for, not why.
  const nodeControlsOpen = selection !== null;
  const panelCount =
    (leftTab ? 1 : 0) + (nodeControlsOpen ? 1 : 0) + (chatOpen ? 1 : 0) + (simulateOpen ? 1 : 0);

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
    <AppShell
      panelCount={panelCount}
      topBar={
        <TopBar
          actions={
            <ImportExportToolbar
              onOpenSettings={() => setSettingsOpen(true)}
              onSaveToGitHub={() => setSaveRepoOpen(true)}
              onShare={() => setShareOpen(true)}
            />
          }
        />
      }
      rail={<LeftRail />}
      leftPanel={<LeftPanel />}
      canvas={
        <>
          <Canvas />
          {/* The one floating app action left on the canvas. Everything else
              that used to sit up here is a rail tab or lives in the bottom
              action bar now. */}
          {spec && (hasLlmKey || runnerUrl) && !simulateOpen && (
            <div className="absolute right-3 top-3 z-10">
              <Button icon={Play} onClick={() => setSimulateOpen(true)} className="shadow-elev-1">
                Simulate
              </Button>
            </div>
          )}
        </>
      }
      // DOM order is the layout: simulate is last, so it lands against the
      // right edge, then the assistant, with node controls nearest the graph.
      rightPanels={
        <>
          <FlowInspector />
          <EdgeInspector />
          <ChatPanel
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            onOpenSettings={() => {
              setChatOpen(false);
              setSettingsOpen(true);
            }}
          />
          <SimulatePanel
            open={simulateOpen}
            onClose={() => setSimulateOpen(false)}
            onOpenSettings={() => {
              setSimulateOpen(false);
              setSettingsOpen(true);
            }}
          />
        </>
      }
      overlays={
        <>
          <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
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
      }
    />
  );
}
