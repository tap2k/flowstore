import { useEffect, useState } from "react";
import Head from "next/head";
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
import { validateSpec } from "@/lib/validation/ajv";

export default function Home() {
  const spec = useSpecStore((s) => s.spec);
  const setSpec = useSpecStore((s) => s.setSpec);
  const apiKey = useSettingsStore((s) => s.googleApiKey);
  const runnerUrl = useSettingsStore((s) => s.runnerUrl);
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
    // localStorage is client-only; flipping the gate after mount is the whole
    // point — gates the first render to avoid flashing the empty state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrating(false);
  }, [setSpec]);

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
      <Head>
        <title>{spec ? `uxflows — ${spec.agent.meta.name}` : "uxflows"}</title>
      </Head>
      <div className="flex flex-col h-screen bg-zinc-50">
        <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-6 py-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold text-zinc-900">
              {spec ? spec.agent.meta.name : "uxflows"}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <ImportExportToolbar onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        </header>
        <main className="flex flex-1 min-h-0">
          <div className="relative flex-1 min-w-0">
            <Canvas />
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
              {spec && runnerUrl && !simulateOpen && (
                <button
                  onClick={() => setSimulateOpen(true)}
                  className="flex items-center gap-1.5 rounded-full bg-white border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-900 shadow-sm hover:bg-zinc-50"
                >
                  <SimulateIcon />
                  Simulate
                </button>
              )}
              {apiKey && !chatOpen && (
                <button
                  onClick={() => setChatOpen(true)}
                  className="flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white shadow-md hover:bg-zinc-700"
                >
                  <ChatIcon />
                  Chat
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

function ChatIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
