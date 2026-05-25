import { useEffect, useState } from "react";
import { Canvas } from "@/components/canvas/Canvas";
import { FlowInspector } from "@/components/inspector/FlowInspector";
import { EdgeInspector } from "@/components/inspector/EdgeInspector";
import { ImportExportToolbar } from "@/components/toolbar/ImportExport";
import { SettingsSheet } from "@/components/sheets/SettingsSheet";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SimulatePanel } from "@/components/runtime/SimulatePanel";
import { useSpecStore } from "@/lib/store/spec";
import {
  clearSavedSpec,
  loadSavedSpec,
  startSpecPersistence,
} from "@/lib/store/persistence";
import { loadSavedSettings, useSettingsStore } from "@/lib/store/settings";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import { validateSpec } from "@flowstore/core/validation/ajv";

export function App() {
  const spec = useSpecStore((s) => s.spec);
  const setSpec = useSpecStore((s) => s.setSpec);
  // Any configured LLM provider unlocks the prompt-mode panels (Run in
  // prompt mode + Assistant). Google-only here would have hidden them
  // for OpenAI-only / OpenRouter-only users.
  const hasLlmKey = useSettingsStore(
    (s) => !!(s.googleApiKey || s.openaiApiKey || s.openrouterApiKey),
  );
  const runnerUrl = useSettingsStore((s) => s.runnerUrl);
  const githubLocation = useGithubProjectStore((s) => s.location);
  const [hydrating, setHydrating] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);

  useEffect(() => startSpecPersistence(), []);

  useEffect(() => {
    loadSavedSettings();
    const saved = loadSavedSpec();
    if (saved) {
      const result = validateSpec(saved);
      if (result.valid) setSpec(result.spec);
      else clearSavedSpec();
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrating(false);
  }, [setSpec]);

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

  if (hydrating) return null;

  return (
    <>
      <div className="flex flex-col h-screen bg-zinc-50">
        <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-6 py-3">
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold text-zinc-900 leading-tight">
              {spec ? spec.agent.meta.name : "flowstore"}
            </h1>
            {githubLocation && (
              <div className="text-[11px] text-zinc-500 font-mono leading-tight">
                {githubLocation.owner}/{githubLocation.repo}@{githubLocation.ref}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-4">
            <ImportExportToolbar onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        </header>
        <main className="flex flex-1 min-h-0">
          <div className="relative flex-1 min-w-0">
            <Canvas />
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
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
    </>
  );
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

function SimulateIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}
