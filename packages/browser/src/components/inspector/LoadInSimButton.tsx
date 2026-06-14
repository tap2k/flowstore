import { useSimulateStore } from "@/lib/store/simulate";
import { hasKeyForModel, useSettingsStore } from "@/lib/store/settings";
import type { RouteTarget } from "@flowstore/core/runtime/routeToTarget";

// "Load in Sim" — synthesize a goal-directed persona that steers a simulated
// conversation toward this flow/edge, hydrate the Simulate persona buffers, and
// open the panel for review. Key-gated: synthesis (and the persona loop it
// feeds) both need a persona LLM key, so with none the button is inert with a
// tooltip pointing at Settings.
export function LoadInSimButton({ target }: { target: RouteTarget }) {
  const personaModel = useSettingsStore((s) => s.simulatePersonaModel);
  // Subscribe to the key fields so the gate reacts when a key is added/removed;
  // hasKeyForModel reads them via getState, but selecting them keeps us live.
  useSettingsStore((s) => `${s.googleApiKey}|${s.openaiApiKey}|${s.openrouterApiKey}`);
  const hasKey = hasKeyForModel(personaModel);
  const synthesizing = useSimulateStore((s) => s.routeSynthesizing);
  const loadRouteTarget = useSimulateStore((s) => s.loadRouteTarget);

  return (
    <button
      disabled={!hasKey || synthesizing}
      onClick={() => loadRouteTarget(target)}
      title={
        hasKey
          ? "Synthesize a persona that steers a simulation to here"
          : "Add an LLM key in Settings to simulate"
      }
      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {synthesizing ? "Synthesizing…" : "Load in Sim ▶"}
    </button>
  );
}
