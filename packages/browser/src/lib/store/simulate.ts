import { create, type StoreApi } from "zustand";
import type { Spec } from "@flowstore/core/schema/v0";
import type { RuntimeEvent } from "@flowstore/core/runtime/eventTypes";
import { type TranscriptTurn } from "@flowstore/core/runtime/transcript";
import {
  endSession as apiEndSession,
  sendTurn as apiSendTurn,
  startSession as apiStartSession,
} from "@flowstore/core/runtime/textClient";
import {
  sendAgentTurn,
  generateSessionId,
} from "@flowstore/core/runtime/httpAgentClient";
import type { AgentEndpoint } from "@flowstore/core/files/models";
import { sendPromptTurn, type CapabilityInvocation } from "@flowstore/core/runtime/promptClient";
import { generatePersonaTurn } from "@flowstore/core/runtime/personaClient";
import { generateRoutePersona } from "@flowstore/core/runtime/personaGen";
import {
  routeToTarget,
  deriveVarsFromRoute,
  type RouteTarget,
} from "@flowstore/core/runtime/routeToTarget";
import { collectDeclaredVariables } from "@flowstore/core/runtime/contextVars";
import { collectMockableCapabilities } from "@flowstore/core/runtime/capabilityMocks";
import { generateContextVars } from "@flowstore/core/runtime/contextVarsGen";
import { generateCapabilityMocks } from "@flowstore/core/runtime/capabilityMocksGen";
import { asrShape, maybeBargeIn, type AsrLevel } from "@/lib/runtime/asrShape";
// Type-only import: VoiceSession (and the @google/genai SDK it pulls) is
// loaded lazily inside the voice branch of start(), so text/runner sessions
// never bundle the Live SDK.
import type { VoiceSession, VoicePhase } from "@/lib/runtime/voiceSession";
import { generateSystemPrompt, ALL_LANGUAGES } from "@flowstore/core/codegen/promptGenerator";
import {
  buildCapabilityTools,
  cleanMockReturns,
  resolveMockedCall,
} from "@flowstore/core/runtime/capabilityMocks";
import { providedVars } from "@flowstore/core/runtime/contextVars";
import type { GuardrailVerdict } from "@flowstore/core/runtime/judgeGuardrails";
import type { RubricVerdict } from "@flowstore/core/runtime/judgeRubric";
import type { GoldTurnVerdict } from "@flowstore/core/runtime/judgeGoldTurn";
import { resolveDispatch, supportsStructuredOutput, useSettingsStore } from "@/lib/store/settings";
import { buildTransitionTable } from "@flowstore/core/runtime/transitionTable";
import {
  runFlowDecode,
  resolveDecodedPath,
  type ResolvedAttribution,
  type ResolvedPath,
} from "@flowstore/core/runtime/flowWatcher";
import { useModelsStore } from "@/lib/store/models";
import { useUiStore } from "@/lib/store/ui";
import { useSpecStore } from "@/lib/store/spec";
import { createScopedJsonStorage, isPlainObject } from "@/lib/store/scopedStorage";
import type { ChatUsage, ProviderId } from "@flowstore/core/llm/types";

export type { TranscriptTurn };

export type SimulateStatus =
  | "idle"
  | "starting"
  | "ready"
  | "thinking"
  | "ended"
  | "error";

// "text" and "voice" are both browser-direct prompt mode (compiled monolith
// system prompt, capability mocks, no Python runner) — they differ only in
// transport (turn-based HTTP vs. a Gemini Live bidi audio socket). "runner"
// drives the Python per-flow runtime. "external" drives an opaque HTTP
// conversational agent (e.g. Rasa) via httpAgentClient.
// isPromptMode groups the two browser-direct LLM modes.
export type SimulateMode = "text" | "voice" | "runner" | "external";

export const isPromptMode = (m: SimulateMode): boolean => m === "text" || m === "voice";

// Elicits the agent's opener in prompt mode (Gemini requires at least one user content).
// Filtered from transcript display and captured cases.
export const PROMPT_MODE_BEGIN = "[begin]";

// Models a "no-input" event — the caller stayed silent. A real voice pipeline
// never sends an empty utterance to the LLM; VAD/ASR emits a no-speech event and
// the dialog layer injects a described signal instead. We do the same so the
// agent's re-prompt / timeout handling actually fires, rather than the model
// seeing a blank turn and returning nothing. Sent verbatim as the user turn.
export const NO_INPUT_MARKER = "[user did not respond]";

// Transcript events for the capability calls a prompt-mode turn made, so mocked
// tool calls show in the timeline the same way runner-mode capability calls do.
function capabilityEvents(
  invocations: CapabilityInvocation[],
  sessionId: string,
): RuntimeEvent[] {
  const out: RuntimeEvent[] = [];
  for (const inv of invocations) {
    const ts = new Date().toISOString();
    out.push({
      type: "capability_invoked",
      capability_name: inv.name,
      args: inv.args,
      session_id: sessionId,
      ts,
    });
    out.push({
      type: "capability_returned",
      capability_name: inv.name,
      result: inv.result,
      error: null,
      session_id: sessionId,
      ts,
    });
  }
  return out;
}

export interface StartArgs {
  mode: SimulateMode;
  spec: Spec;
  apiKey: string;
  model: string;
  // null when no provider key is configured; prompt mode rejects, runner passes through.
  provider: ProviderId | null;
  // Only meaningful for the openai-compatible adapter (OpenRouter).
  baseUrl?: string;
  language?: string;
  // External agent endpoint — required when mode === "external".
  agentEntry?: AgentEndpoint & { id: string };
}

interface SimulateState {
  mode: SimulateMode;
  sessionId: string | null;
  baseUrl: string | null;
  status: SimulateStatus;
  transcript: TranscriptTurn[];
  events: RuntimeEvent[];
  currentFlowId: string | null;
  traversedEdgeIds: string[];
  traversedFlowIds: string[];
  variables: Record<string, unknown>;
  // Character sheet (persona ∪ case fixture). Only provided-declared keys ship at session start.
  contextVars: Record<string, unknown>;
  contextVarsAgentId: string | null;
  mockReturns: Record<string, Record<string, unknown>>;
  // Error-behavior sentinels. Per-capability; setting one clears mockReturns for that capability.
  mockErrors: Record<string, string>;
  mockReturnsAgentId: string | null;
  error: string | null;
  // Prompt-mode state. Frozen at session start; reset clears.
  systemPrompt: string | null;
  specSnapshot: Spec | null;
  lastUsage: ChatUsage | null;
  // Voice-mode indicator: who currently holds the floor on the live socket.
  // null in text/runner mode and between voice sessions.
  voicePhase: VoicePhase | null;
  // Mutes audio in voice mode without tearing the capture graph (no re-prompt for permission).
  micMuted: boolean;
  // Only personaPrompt persists per agent (localStorage); autoStepping guards against panel re-fire.
  personaPrompt: string;
  // Behavioral knobs rendered into the user-sim prompt. Per-session; re-pick persona to reload.
  personaTraits?: Record<string, string | number | boolean>;
  autoRun: boolean;
  personaAgentId: string | null;
  autoStepping: boolean;
  // Persona target set via "Load in Sim". Cleared on user edit or saved-persona load.
  routeTarget: {
    target: RouteTarget;
    label: string;
    // calc/direct conditions we couldn't safely invert to a fixture value.
    underivable: string[];
    // vars derived but not declared `provided: true`; won't ship at session start.
    notProvided: string[];
  } | null;
  // True while a route persona is being synthesized (an LLM call).
  routeSynthesizing: boolean;
  // limit = input budget; left = live countdown (reaches 0 → loop stops). Both refill on Start.
  personaTurnLimit: number;
  personaTurnsLeft: number;
  // Active-case binding; null = free-play mode. Set via "Open in Sim ▶".
  activeCaseId: string | null;
  // Mutually exclusive with activeCaseId (setting one clears the other). In-memory only.
  activeGoldId: string | null;
  // undefined = "auto" (default language, voice auto-detects). A code pins scripts/FAQ and
  // hints voice transcription. Lifted from SimulatePanel so "Open in Sim" can override the picker.
  language: string | undefined;

  // Active external agent endpoint (set when mode === "external"). Stored so
  // send() can call it without re-resolving from the models store each turn.
  agentEntry: (AgentEndpoint & { id: string }) | null;

  // Transcript evaluation results, in store so ChatPanel can read without recomputing.
  // All cleared on start/reset/send/fork; rubricVerdicts uses "pending" while in-flight.
  guardrailVerdict: GuardrailVerdict | null;
  rubricVerdicts: Record<string, RubricVerdict | "pending">;
  // Per-agent-turn semantic verdicts for the active gold (keyed by 0-based gold agent-turn
  // index). null = evaluation not yet run. "pending" = LLM call in-flight.
  goldTurnVerdicts: Record<number, GoldTurnVerdict | "pending"> | null;

  // Prompt-mode graph attribution (the flow watcher — see @flowstore/core
  // runtime/flowWatcher). The runner gets exact attribution from its events;
  // prompt mode (text) has no source, so a small structured LLM call infers the
  // current flow + the transition taken, and reachability flags illegal jumps.
  // It writes currentFlowId/traversedEdgeIds (reusing the existing canvas glow)
  // AND this `attribution` (confidence texture + failure paint). null in
  // runner/external/voice modes and before the first attributed turn.
  // attributionSeq race-guards async watcher results against newer turns/resets.
  attribution: ResolvedAttribution | null;
  attributionSeq: number;

  setMode: (mode: SimulateMode) => void;
  setMicMuted: (muted: boolean) => void;
  start: (args: StartArgs) => Promise<void>;
  send: (userText: string) => Promise<void>;
  reset: () => Promise<void>;
  fork: (turnIndex: number) => void;
  hydrateContextVars: (agentId: string) => void;
  setContextVar: (name: string, value: unknown) => void;
  setContextVars: (values: Record<string, unknown>) => void;
  clearContextVars: () => void;
  hydrateMockReturns: (agentId: string) => void;
  setMockOutput: (capabilityName: string, outputName: string, value: unknown) => void;
  setMockReturnsForCapability: (
    capabilityName: string,
    values: Record<string, unknown>,
  ) => void;
  setMockReturns: (values: Record<string, Record<string, unknown>>) => void;
  // Pass null to revert to static-behavior (clears sentinel; mockReturns become live again).
  setMockError: (capabilityName: string, error: string | null) => void;
  clearMockReturnsForCapability: (capabilityName: string) => void;
  clearMockReturns: () => void;
  hydratePersona: (agentId: string) => void;
  setPersonaPrompt: (prompt: string) => void;
  // Synthesize a goal-directed persona toward a flow/edge; does NOT auto-run.
  loadRouteTarget: (target: RouteTarget) => Promise<void>;
  clearRouteTarget: () => void;
  setPersonaTraits: (traits: Record<string, string | number | boolean> | undefined) => void;
  setAutoRun: (on: boolean) => void;
  setPersonaTurnLimit: (n: number) => void;
  autoStep: () => Promise<void>;
  setActiveCaseId: (id: string | null) => void;
  setActiveGoldId: (id: string | null) => void;
  setLanguage: (lang: string | undefined) => void;
  setGuardrailVerdict: (verdict: GuardrailVerdict | null) => void;
  setRubricVerdicts: (verdicts: Record<string, RubricVerdict | "pending">) => void;
  patchRubricVerdict: (id: string, verdict: RubricVerdict | "pending") => void;
  setGoldTurnVerdicts: (verdicts: Record<number, GoldTurnVerdict | "pending"> | null) => void;
  patchGoldTurnVerdict: (idx: number, verdict: GoldTurnVerdict | "pending") => void;
  clearEvaluation: () => void;
}

const varsStorage = createScopedJsonStorage<Record<string, unknown>>({
  prefix: "flowstore:simulate:vars:",
  defaultValue: () => ({}),
  validate: (raw) => (isPlainObject(raw) ? raw : null),
  isEmpty: (v) => Object.keys(v).length === 0,
});

const mocksStorage = createScopedJsonStorage<Record<string, Record<string, unknown>>>({
  prefix: "flowstore:simulate:mocks:",
  defaultValue: () => ({}),
  validate: (raw) =>
    isPlainObject(raw) ? (raw as Record<string, Record<string, unknown>>) : null,
  isEmpty: (v) => Object.keys(v).length === 0,
});

// Persona prompt persists per agent; turn limit, countdown, and autoRun are
// per-run intent and reset on hydrate.
const personaStorage = createScopedJsonStorage<{ prompt: string }>({
  prefix: "flowstore:simulate:persona:",
  defaultValue: () => ({ prompt: "" }),
  validate: (raw) =>
    isPlainObject(raw) && typeof raw.prompt === "string" ? { prompt: raw.prompt } : null,
  isEmpty: (v) => !v.prompt,
});

// Active-case binding persists across reload/HMR via lightweight localStorage read/write
// (single global; transcript/sessionId/events are runtime artifacts and re-derive on Run).
const ACTIVE_CASE_KEY = "flowstore:simulate_auth";

function loadActiveCaseId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_CASE_KEY);
    // Pre-persist builds stored a JSON envelope ({"activeCaseId":"…"}) under
    // this key. Ignore that shape so it can't hydrate as a bogus case id; the
    // next setActiveCaseId overwrites it with a bare id.
    if (!raw || raw.startsWith("{")) return null;
    return raw;
  } catch {
    return null;
  }
}

function persistActiveCaseId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(ACTIVE_CASE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_CASE_KEY);
  } catch {
    // ignore
  }
}

function reduceEvents(
  state: Pick<SimulateState, "currentFlowId" | "traversedEdgeIds" | "traversedFlowIds" | "variables" | "status">,
  events: RuntimeEvent[],
): Pick<SimulateState, "currentFlowId" | "traversedEdgeIds" | "traversedFlowIds" | "variables" | "status"> {
  let { currentFlowId, traversedEdgeIds, traversedFlowIds, variables, status } = state;
  for (const ev of events) {
    if (ev.type === "flow_entered") {
      currentFlowId = ev.flow_id;
      if (traversedFlowIds[traversedFlowIds.length - 1] !== ev.flow_id) {
        traversedFlowIds = [...traversedFlowIds, ev.flow_id];
      }
    } else if (ev.type === "exit_path_taken") {
      traversedEdgeIds = [...traversedEdgeIds, `${ev.from_flow_id}__${ev.exit_path_id}`];
    } else if (ev.type === "variable_set") {
      variables = { ...variables, [ev.variable_name]: ev.value };
    } else if (ev.type === "session_ended") {
      status = "ended";
    }
  }
  return { currentFlowId, traversedEdgeIds, traversedFlowIds, variables, status };
}

// The live voice session is a non-serializable controller (WebSocket +
// AudioContexts), so it lives outside the zustand state — the store holds
// only the derived, serializable bits (transcript, status, voicePhase).
let voiceSession: VoiceSession | null = null;

export const useSimulateStore = create<SimulateState>((set, get) => ({
  mode: "text",
  sessionId: null,
  baseUrl: null,
  status: "idle",
  transcript: [],
  events: [],
  currentFlowId: null,
  traversedEdgeIds: [],
  traversedFlowIds: [],
  variables: {},
  contextVars: {},
  contextVarsAgentId: null,
  mockReturns: {},
  mockErrors: {},
  mockReturnsAgentId: null,
  error: null,
  systemPrompt: null,
  specSnapshot: null,
  lastUsage: null,
  voicePhase: null,
  micMuted: false,
  personaPrompt: "",
  autoRun: false,
  personaAgentId: null,
  autoStepping: false,
  routeTarget: null,
  routeSynthesizing: false,
  personaTurnLimit: 10,
  personaTurnsLeft: 0,
  activeCaseId: loadActiveCaseId(),
  activeGoldId: null,
  language: undefined,
  agentEntry: null,
  guardrailVerdict: null,
  rubricVerdicts: {},
  goldTurnVerdicts: null,
  attribution: null,
  attributionSeq: 0,

  setMode: (mode) => {
    if (get().sessionId) return; // mode is frozen during an active session
    set({ mode });
  },

  setMicMuted: (muted) => {
    voiceSession?.setMuted(muted);
    set({ micMuted: muted });
  },

  hydrateContextVars: (agentId) => {
    const current = get();
    if (current.contextVarsAgentId === agentId) return;
    set({ contextVars: varsStorage.load(agentId), contextVarsAgentId: agentId });
  },

  setContextVar: (name, value) => {
    const { contextVars, contextVarsAgentId } = get();
    const next = { ...contextVars };
    if (value === undefined || value === null || value === "") delete next[name];
    else next[name] = value;
    set({ contextVars: next });
    if (contextVarsAgentId) varsStorage.save(contextVarsAgentId, next);
  },

  setContextVars: (values) => {
    const { contextVarsAgentId } = get();
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined || v === null || v === "") continue;
      cleaned[k] = v;
    }
    set({ contextVars: cleaned });
    if (contextVarsAgentId) varsStorage.save(contextVarsAgentId, cleaned);
  },

  clearContextVars: () => {
    const { contextVars, contextVarsAgentId } = get();
    if (Object.keys(contextVars).length === 0) return;
    set({ contextVars: {} });
    if (contextVarsAgentId) varsStorage.save(contextVarsAgentId, {});
  },

  hydrateMockReturns: (agentId) => {
    const current = get();
    if (current.mockReturnsAgentId === agentId) return;
    set({ mockReturns: mocksStorage.load(agentId), mockReturnsAgentId: agentId });
  },

  setMockOutput: (capabilityName, outputName, value) => {
    const { mockReturns, mockErrors, mockReturnsAgentId } = get();
    const existing = mockReturns[capabilityName] ?? {};
    const nextOutputs = { ...existing };
    if (value === undefined || value === null || value === "") {
      delete nextOutputs[outputName];
    } else {
      nextOutputs[outputName] = value;
    }
    const next = { ...mockReturns };
    if (Object.keys(nextOutputs).length === 0) {
      delete next[capabilityName];
    } else {
      next[capabilityName] = nextOutputs;
    }
    // Authoring static returns implicitly leaves error behavior.
    const nextErrors = { ...mockErrors };
    delete nextErrors[capabilityName];
    set({ mockReturns: next, mockErrors: nextErrors });
    if (mockReturnsAgentId) mocksStorage.save(mockReturnsAgentId, next);
  },

  setMockError: (capabilityName, error) => {
    const { mockReturns, mockErrors, mockReturnsAgentId } = get();
    const nextErrors = { ...mockErrors };
    const nextReturns = { ...mockReturns };
    if (error === null || error === "") {
      delete nextErrors[capabilityName];
    } else {
      nextErrors[capabilityName] = error;
      // Static returns and error sentinel are mutually exclusive.
      delete nextReturns[capabilityName];
    }
    set({ mockErrors: nextErrors, mockReturns: nextReturns });
    if (mockReturnsAgentId) mocksStorage.save(mockReturnsAgentId, nextReturns);
  },

  setMockReturnsForCapability: (capabilityName, values) => {
    const { mockReturns, mockReturnsAgentId } = get();
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined || v === null || v === "") continue;
      cleaned[k] = v;
    }
    const next = { ...mockReturns };
    if (Object.keys(cleaned).length === 0) {
      delete next[capabilityName];
    } else {
      next[capabilityName] = cleaned;
    }
    set({ mockReturns: next });
    if (mockReturnsAgentId) mocksStorage.save(mockReturnsAgentId, next);
  },

  setMockReturns: (values) => {
    const { mockReturnsAgentId } = get();
    const cleaned: Record<string, Record<string, unknown>> = {};
    for (const [capName, outputs] of Object.entries(values)) {
      if (!outputs || typeof outputs !== "object") continue;
      const inner: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(outputs)) {
        if (v === undefined || v === null || v === "") continue;
        inner[k] = v;
      }
      if (Object.keys(inner).length > 0) cleaned[capName] = inner;
    }
    set({ mockReturns: cleaned });
    if (mockReturnsAgentId) mocksStorage.save(mockReturnsAgentId, cleaned);
  },

  clearMockReturnsForCapability: (capabilityName) => {
    const { mockReturns, mockErrors, mockReturnsAgentId } = get();
    const nextReturns = { ...mockReturns };
    delete nextReturns[capabilityName];
    const nextErrors = { ...mockErrors };
    delete nextErrors[capabilityName];
    set({ mockReturns: nextReturns, mockErrors: nextErrors });
    if (mockReturnsAgentId) mocksStorage.save(mockReturnsAgentId, nextReturns);
  },

  clearMockReturns: () => {
    const { mockReturns, mockErrors, mockReturnsAgentId } = get();
    if (
      Object.keys(mockReturns).length === 0 &&
      Object.keys(mockErrors).length === 0
    )
      return;
    set({ mockReturns: {}, mockErrors: {} });
    if (mockReturnsAgentId) mocksStorage.save(mockReturnsAgentId, {});
  },

  hydratePersona: (agentId) => {
    const current = get();
    if (current.personaAgentId === agentId) return;
    set({
      personaPrompt: personaStorage.load(agentId).prompt,
      // Traits aren't persisted with the prompt; they reload when a persona is
      // picked. Switching agents starts with none.
      personaTraits: undefined,
      personaTurnLimit: 10,
      personaTurnsLeft: 0,
      autoRun: false,
      personaAgentId: agentId,
    });
  },

  setPersonaPrompt: (prompt) => {
    const { personaAgentId } = get();
    // A manual edit (or loading a saved persona) detaches the prompt from the
    // route it was synthesized for, so the provenance note no longer applies.
    set({ personaPrompt: prompt, routeTarget: null });
    if (personaAgentId) personaStorage.save(personaAgentId, { prompt });
  },

  clearRouteTarget: () => set({ routeTarget: null }),

  loadRouteTarget: async (target) => {
    const spec = useSpecStore.getState().spec;
    if (!spec) return;

    const route = routeToTarget(spec, target);
    if (!route.found) {
      set({
        error:
          target.kind === "exit"
            ? "That branch isn't reachable from the entry flow."
            : `"${route.targetFlowName ?? "That flow"}" isn't reachable from the entry flow.`,
      });
      return;
    }

    const creds = readLlmCreds("persona");
    if (!creds.provider || !creds.apiKey) {
      // Button is key-gated, so this is a defensive guard, not a normal path.
      set({ error: `Persona synthesis needs a ${creds.endpointLabel} API key in Settings.` });
      return;
    }

    // Bind the buffers to this agent FIRST (loading any saved values), so our
    // writes below persist and the SimulatePanel's open-effect — which hydrates
    // on first open — sees a matching agentId and no-ops instead of clobbering
    // the fixture we're about to set. hydratePersona also resets personaPrompt,
    // so it must run before we write the synthesized prompt.
    get().hydrateContextVars(spec.agent.id);
    get().hydrateMockReturns(spec.agent.id);
    get().hydratePersona(spec.agent.id);

    // Open the live simulate tab — the synthesized persona is a temporary,
    // throwaway world, not one to manage in the personas tab. The simulate tab
    // already renders the PersonaForm (prompt + provenance note + auto-play
    // controls), so the user reviews the goal and presses play right there.
    useUiStore.getState().setSimulateOpen(true);
    useUiStore.getState().setOpenSimulateTab("simulate");

    // Deterministically-seeded vars — the trustworthy source for the calc/direct
    // gates, overlaid on the LLM guess below.
    const derived = deriveVarsFromRoute(route.structuralConditions);

    // Show the goal + "Synthesizing…" BEFORE the await, so the persona section
    // expands and the user sees what's happening while the LLM works.
    const label = route.targetExit
      ? `${route.targetFlowName ?? target.flowId} → ${
          route.targetExit.notes || route.targetExit.condition?.expression || route.targetExit.id
        }`
      : route.targetFlowName ?? target.flowId;
    set({
      routeSynthesizing: true,
      error: null,
      personaTraits: undefined,
      routeTarget: { target, label, underivable: derived.underivable, notProvided: [] },
    });

    const provider = creds.provider; // null-checked above
    const canFixture = supportsStructuredOutput(
      useSettingsStore.getState().simulatePersonaModel,
    );
    const goalNote = { notes: `This persona's goal is to reach: ${label}.` };
    let systemPrompt = "";
    let llmVars: Record<string, unknown> = {};
    let llmMockReturns: Record<string, Record<string, unknown>> = {};
    try {
      // Prose persona (portable text) + LLM fixture (vars then mocks, the same
      // mechanism generatePersonaContent uses — vars first so the mock generator
      // can ground returns against them). The LLM fixture is a best guess; the
      // deterministic fixture overlays it per-key below.
      systemPrompt = await generateRoutePersona({
        spec,
        route,
        provider,
        apiKey: creds.apiKey,
        model: creds.model,
      });
      if (canFixture) {
        const declared = collectDeclaredVariables(spec);
        if (declared.length > 0) {
          llmVars = await generateContextVars(spec, provider, creds.apiKey, creds.model, declared, goalNote);
        }
        const caps = collectMockableCapabilities(spec);
        if (caps.length > 0) {
          llmMockReturns = await generateCapabilityMocks(
            spec,
            provider,
            creds.apiKey,
            creds.model,
            caps,
            llmVars,
            goalNote,
          );
        }
      }
    } catch (e) {
      set({
        routeSynthesizing: false,
        error: `Couldn't synthesize a persona: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }

    // Merge: deterministic vars win per-key over the LLM guess. Mocks come from
    // the LLM alone — deterministic mock derivation is always the compound case
    // we refuse to guess (see deriveVarsFromRoute).
    const mergedVars = { ...llmVars, ...derived.vars };

    // Derived (deterministic) vars only seed the agent if declared `provided`.
    const agentVars = spec.agent.variables ?? {};
    const notProvided = Object.keys(derived.vars).filter(
      (name) => !agentVars[name]?.provided,
    );

    get().setContextVars(mergedVars);
    get().setMockReturns(llmMockReturns);

    const { personaAgentId } = get();
    if (personaAgentId) personaStorage.save(personaAgentId, { prompt: systemPrompt });
    set({
      personaPrompt: systemPrompt,
      routeSynthesizing: false,
      routeTarget: { target, label, underivable: derived.underivable, notProvided },
    });
  },

  setPersonaTraits: (traits) => set({ personaTraits: traits }),

  setAutoRun: (on) => {
    if (on) {
      // Start: refill the countdown and clear any prior "ended" so the loop
      // can push forward in the same session.
      const { personaTurnLimit, status } = get();
      set({
        autoRun: true,
        personaTurnsLeft: personaTurnLimit,
        status: status === "ended" ? "ready" : status,
      });
    } else {
      set({ autoRun: false });
    }
  },

  setPersonaTurnLimit: (n) => {
    const clamped = Math.max(1, Math.floor(Number.isFinite(n) ? n : 10));
    set({ personaTurnLimit: clamped });
  },

  setActiveCaseId: (id) => {
    persistActiveCaseId(id);
    // A case and a gold can't both be the active binding — clear the gold.
    set({ activeCaseId: id, ...(id ? { activeGoldId: null } : {}) });
  },

  setActiveGoldId: (id) => {
    // Binding a gold supersedes any active case (and its persisted key).
    if (id) persistActiveCaseId(null);
    set({ activeGoldId: id, goldTurnVerdicts: null, ...(id ? { activeCaseId: null } : {}) });
  },

  setLanguage: (lang) => {
    set({ language: lang });
  },

  setGuardrailVerdict: (verdict) => {
    set({ guardrailVerdict: verdict });
  },

  setRubricVerdicts: (verdicts) => {
    set({ rubricVerdicts: verdicts });
  },

  patchRubricVerdict: (id, verdict) => {
    set({ rubricVerdicts: { ...get().rubricVerdicts, [id]: verdict } });
  },

  setGoldTurnVerdicts: (verdicts) => {
    set({ goldTurnVerdicts: verdicts });
  },

  patchGoldTurnVerdict: (idx, verdict) => {
    set({ goldTurnVerdicts: { ...get().goldTurnVerdicts, [idx]: verdict } });
  },

  clearEvaluation: () => {
    set({ guardrailVerdict: null, rubricVerdicts: {}, goldTurnVerdicts: null });
  },

  autoStep: async () => {
    const {
      personaPrompt,
      personaTurnsLeft,
      transcript,
      status,
      sessionId,
      autoStepping,
    } = get();
    if (autoStepping) return;
    if (!sessionId) return;
    // Persona auto-run drives typed user turns; voice has no text input.
    if (get().mode === "voice") return;
    if (status !== "ready") return;
    if (!personaPrompt.trim()) return;
    if (personaTurnsLeft <= 0) {
      set({ autoRun: false });
      return;
    }
    const creds = readLlmCreds("persona");
    if (!creds.provider || !creds.apiKey) {
      set({
        autoRun: false,
        error: `Persona auto-run needs a ${creds.endpointLabel} API key in Settings.`,
      });
      return;
    }
    set({ autoStepping: true, error: null });
    try {
      // Barge-in: the caller cuts the agent off, at the persona's barge_in trait
      // propensity (0–1). When it fires, trim the prior agent turn to a heard-
      // prefix before the persona responds, so the persona reacts to half a
      // reply and the agent's next turn sees it was interrupted. Text/prompt mode
      // only (runner keeps history server-side). Persona-owned (saved on the
      // persona) so the same propensity drives the Python harness too.
      const bargeMeta = get().specSnapshot?.agent.meta;
      const bargeVoice =
        bargeMeta?.modality === "voice" || bargeMeta?.modality === "multimodal";
      const bargeProp = Number(get().personaTraits?.barge_in) || 0;
      const lastTurn = transcript[transcript.length - 1];
      let history = transcript;
      let bargedIn = false;
      if (get().mode === "text" && bargeVoice && lastTurn?.role === "agent" && lastTurn.text) {
        const heard = maybeBargeIn(lastTurn.text, bargeProp);
        if (heard !== null) {
          history = [...transcript.slice(0, -1), { ...lastTurn, text: heard }];
          set({ transcript: history });
          bargedIn = true;
        }
      }
      const res = await generatePersonaTurn({
        personaPrompt,
        // The medium-aware rail follows the running session's modality.
        modality: get().specSnapshot?.agent.meta.modality ?? "text",
        // Keep the synthetic [begin] trigger out of the persona's view — it
        // isn't something the user said.
        history: history.filter((t) => t.text !== PROMPT_MODE_BEGIN),
        bargedIn,
        apiKey: creds.apiKey,
        model: creds.model,
        provider: creds.provider,
        baseUrl: creds.baseUrl,
      });
      // If the user hit Stop while the LLM was thinking, drop the result.
      if (!get().autoRun) return;
      const { text: cleaned, done } = stripDoneMarker(res.text);
      if (done) {
        // Show the persona's [DONE] turn verbatim so it's obvious why the loop
        // stopped, then end without dispatching to the agent.
        const userTurn: TranscriptTurn = {
          role: "user",
          text: res.text.trim(),
          ts: Date.now(),
          events: [],
        };
        set({
          transcript: [...get().transcript, userTurn],
          status: "ended",
          autoRun: false,
        });
        return;
      }
      if (cleaned) {
        // Voice-realistic input: shape the persona's turn like raw ASR
        // (de-punctuated, fillers/false-starts) at the persona's `asr` trait
        // level, for voice/multimodal agents. Persona-owned (saved on the
        // persona), so the same level also drives the Python harness. Gate to a
        // known level (same as the harness) so a hand-edited junk value is a
        // no-op rather than mis-shaping. Non-seeded — see asrShape.ts.
        // Text/prompt mode only, matching barge-in above: against the runner the
        // Python harness owns the seeded asr_shape, so browser shaping would
        // double-garble and diverge from the reproducible path.
        const asr = get().personaTraits?.asr;
        const asrLevel: AsrLevel =
          asr === "clean" || asr === "light" || asr === "heavy" ? asr : "off";
        const meta = get().specSnapshot?.agent.meta;
        const voiceish = meta?.modality === "voice" || meta?.modality === "multimodal";
        const toSend =
          get().mode === "text" && voiceish && asrLevel !== "off"
            ? asrShape(cleaned, asrLevel, get().language ?? meta?.languages?.[0] ?? "EN")
            : cleaned;
        // Delegate to send() so the user turn goes through the same path
        // (handles prompt vs runner, transcript bookkeeping, error state).
        await get().send(toSend);
        set({ personaTurnsLeft: get().personaTurnsLeft - 1 });
        // Empty agent reply during auto-run: stop the loop rather than letting
        // the persona respond to silence and burn the remaining turn budget.
        // send() still records the empty turn for the designer to see.
        const lastTurn = get().transcript.at(-1);
        if (!lastTurn?.text?.trim()) {
          set({ autoRun: false });
          return;
        }
      }
    } catch (e) {
      set({
        autoRun: false,
        error: e instanceof Error ? e.message : "Persona auto-step failed.",
      });
    } finally {
      set({ autoStepping: false });
    }
  },

  start: async (args) => {
    const { mode, spec, apiKey, model, provider, baseUrl, language, agentEntry } = args;
    const { contextVars, mockReturns } = get();
    // Ship only the session-start payload (`provided`-declared keys) — the
    // rest of the vars buffer is character sheet, which the agent must earn
    // through conversation or mocks.
    const shippedVars = providedVars(spec, contextVars);
    // The editable prompt override is produced by the Prompt panel and lives in
    // the ui store; use it if present, else compile fresh from the spec.
    const existingOverride = useUiStore.getState().promptOverride;
    const cleanedMocks = cleanMockReturns(mockReturns, spec);
    // Tear down any prior voice session before a new Start (mode may have
    // changed, or this is a re-run).
    if (voiceSession) {
      voiceSession.stop();
      voiceSession = null;
    }
    set({
      mode,
      status: "starting",
      transcript: [],
      events: [],
      currentFlowId: null,
      traversedEdgeIds: [],
      traversedFlowIds: [],
      variables: {},
      error: null,
      sessionId: null,
      baseUrl: baseUrl ?? null,
      agentEntry: agentEntry ?? null,
      systemPrompt: null,
      specSnapshot: null,
      lastUsage: null,
      voicePhase: null,
      micMuted: false,
      guardrailVerdict: null,
      rubricVerdicts: {},
      goldTurnVerdicts: null,
      attribution: null,
    });

    if (mode === "voice") {
      if (provider !== "google" || !apiKey) {
        set({
          status: "error",
          error:
            "Voice mode needs a Google API key and a Gemini Live model (voice is Gemini-only). Set them in Settings.",
        });
        return;
      }
      try {
        const systemPrompt =
          existingOverride ??
          generateSystemPrompt(spec, shippedVars, { language: language ?? ALL_LANGUAGES });
        const sessionId = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set({ sessionId, systemPrompt, specSnapshot: spec });
        const { VoiceSession } = await import("@/lib/runtime/voiceSession");
        const session = new VoiceSession({
          apiKey,
          model,
          systemPrompt,
          tools: buildCapabilityTools(spec),
          resolveTool: (name, args) =>
            resolveMockedCall(name, args, get().mockReturns, get().mockErrors,
              useModelsStore.getState().config?.capabilityEndpoints ?? {}),
          chatbotInitiates: spec.agent.chatbot_initiates ?? false,
          language,
          onUserTurn: (text) => {
            set({
              transcript: [
                ...get().transcript,
                { role: "user", text, ts: Date.now(), events: [] },
              ],
            });
          },
          onAgentTurn: (text, caps, latencyMs) => {
            set({
              transcript: [
                ...get().transcript,
                {
                  role: "agent",
                  text,
                  ts: Date.now(),
                  events: capabilityEvents(caps, sessionId),
                  ...(latencyMs !== undefined ? { latencyMs } : {}),
                },
              ],
              // A fresh agent turn invalidates any prior evaluation.
              guardrailVerdict: null,
              rubricVerdicts: {},
              goldTurnVerdicts: null,
            });
          },
          onPhase: (phase) => set({ voicePhase: phase }),
          onStatus: (s) => {
            if (s === "ready") set({ status: "ready" });
            else if (s === "closed") set({ status: "ended", voicePhase: null });
          },
          onError: (message) => set({ status: "error", error: message, voicePhase: null }),
        });
        voiceSession = session;
        await session.start();
      } catch (e) {
        if (voiceSession) {
          voiceSession.stop();
          voiceSession = null;
        }
        set({
          status: "error",
          error: e instanceof Error ? e.message : "Failed to start voice session.",
          voicePhase: null,
        });
      }
      return;
    }

    if (mode === "text") {
      if (!provider || !apiKey) {
        set({
          status: "error",
          error: "Prompt-mode session needs an API key for the selected model. Add it in Settings.",
        });
        return;
      }
      try {
        const systemPrompt =
          existingOverride ??
          generateSystemPrompt(spec, shippedVars, { language: language ?? ALL_LANGUAGES });
        const sessionId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // Light the entry flow immediately — the sim starts there, so the graph
        // shouldn't sit dark until the first decode resolves. The watcher walks
        // it forward from here.
        set({
          sessionId,
          systemPrompt,
          specSnapshot: spec,
          currentFlowId: spec.agent.entry_flow_id,
          traversedFlowIds: [spec.agent.entry_flow_id],
        });

        if (spec.agent.chatbot_initiates) {
          const openerTurn: TranscriptTurn = {
            role: "user",
            text: PROMPT_MODE_BEGIN,
            ts: Date.now(),
            events: [],
          };
          set({ transcript: [openerTurn] });
          const t0 = performance.now();
          const res = await sendPromptTurn({
            systemPrompt,
            history: [],
            userText: PROMPT_MODE_BEGIN,
            apiKey,
            model,
            provider,
            baseUrl,
            tools: buildCapabilityTools(spec),
            resolveTool: async (call) => {
              const callArgs = call.arguments && typeof call.arguments === "object"
                ? (call.arguments as Record<string, unknown>) : {};
              return resolveMockedCall(call.name, callArgs, get().mockReturns, get().mockErrors,
                useModelsStore.getState().config?.capabilityEndpoints ?? {});
            },
          });
          const latencyMs = Math.round(performance.now() - t0);
          const agentTurn: TranscriptTurn = {
            role: "agent",
            text: res.text,
            ts: Date.now(),
            events: capabilityEvents(res.invocations, sessionId),
            latencyMs,
          };
          set({
            transcript: [openerTurn, agentTurn],
            lastUsage: res.usage ?? null,
            status: "ready",
          });
          // Attribute the opener so the graph lights up before the first user turn.
          void attributeTurn(set, get, sessionId);
        } else {
          set({ status: "ready" });
        }
      } catch (e) {
        set({
          status: "error",
          error: e instanceof Error ? e.message : "Failed to start prompt session.",
        });
      }
      return;
    }

    if (mode === "external") {
      if (!agentEntry) {
        set({ status: "error", error: "No external agent endpoint configured." });
        return;
      }
      try {
        const sessionId = generateSessionId();
        set({ sessionId, specSnapshot: spec, status: "starting" });
        if (spec.agent.chatbot_initiates) {
          const t0 = performance.now();
          const res = await sendAgentTurn(agentEntry, sessionId, "");
          const latencyMs = Math.round(performance.now() - t0);
          set({
            transcript: [{
              role: "agent",
              text: res.text,
              ts: Date.now(),
              events: [],
              latencyMs,
            }],
            status: res.ended ? "ended" : "ready",
          });
        } else {
          set({ status: "ready" });
        }
      } catch (e) {
        set({ status: "error", error: e instanceof Error ? e.message : "Failed to start external agent session." });
      }
      return;
    }

    if (!baseUrl) {
      set({ status: "error", error: "Runner URL is required for runner mode." });
      return;
    }
    try {
      const t0 = performance.now();
      const res = await apiStartSession({
        baseUrl,
        spec,
        apiKey: apiKey || undefined,
        model: model || undefined,
        // Omit when unpinned → runner emits every declared language.
        language,
        contextVars: shippedVars,
        mockReturns: cleanedMocks,
      });
      const latencyMs = Math.round(performance.now() - t0);
      const reduced = reduceEvents(
        {
          currentFlowId: null,
          traversedEdgeIds: [],
          traversedFlowIds: [],
          variables: {},
          status: "ready",
        },
        res.events,
      );
      const transcript: TranscriptTurn[] = [];
      if (res.agent_text || res.events.length > 0) {
        transcript.push({
          role: "agent",
          text: res.agent_text,
          ts: Date.now(),
          events: res.events,
          latencyMs,
        });
      }
      const ended = res.ended || reduced.status === "ended";
      set({
        sessionId: res.session_id,
        status: ended ? "ended" : reduced.status,
        transcript,
        events: res.events,
        currentFlowId: reduced.currentFlowId,
        traversedEdgeIds: reduced.traversedEdgeIds,
        traversedFlowIds: reduced.traversedFlowIds,
        variables: reduced.variables,
        error: null,
        ...(ended ? { autoRun: false } : {}),
      });
    } catch (e) {
      set({
        status: "error",
        error: e instanceof Error ? e.message : "Failed to start session.",
      });
    }
  },

  send: async (userText) => {
    const {
      mode,
      sessionId,
      baseUrl,
      agentEntry,
      status,
      transcript,
      events,
      currentFlowId,
      traversedEdgeIds,
      traversedFlowIds,
      variables,
      systemPrompt,
      specSnapshot,
    } = get();
    if (!sessionId) return;
    // Voice is mic-driven full-duplex — there are no typed user turns to send.
    if (mode === "voice") return;
    if (status === "thinking" || status === "starting" || status === "ended") return;
    // A blank user turn is a non-prompt: the model has nothing to answer (Gemini
    // returns nothing; GPT invents filler), which never happens in a real voice
    // pipeline — VAD/ASR emits a no-input event, not an empty utterance. So an
    // empty send is substituted with NO_INPUT_MARKER, a described no-input event
    // the agent can react to (and can react wrongly to — that's what we're testing).
    const trimmed = userText.trim() || NO_INPUT_MARKER;
    const userTurn: TranscriptTurn = {
      role: "user",
      text: trimmed,
      ts: Date.now(),
      events: [],
    };
    const nextTranscript = [...transcript, userTurn];
    set({
      status: "thinking",
      transcript: nextTranscript,
      error: null,
      // The conversation moved on — any prior evaluation is now stale.
      guardrailVerdict: null,
      rubricVerdicts: {},
      goldTurnVerdicts: null,
    });

    if (mode === "text") {
      try {
        const creds = readLlmCreds("agent");
        if (!creds.provider || !creds.apiKey) {
          set({
            transcript,
            status: "error",
            error: `Prompt-mode turn needs a ${creds.endpointLabel} API key in Settings.`,
            autoRun: false,
          });
          return;
        }
        const t0 = performance.now();
        const res = await sendPromptTurn({
          systemPrompt: systemPrompt ?? "",
          history: transcript,
          userText: trimmed,
          apiKey: creds.apiKey,
          model: creds.model,
          provider: creds.provider,
          baseUrl: creds.baseUrl,
          tools: buildCapabilityTools(specSnapshot),
          resolveTool: async (call) => {
            const callArgs = call.arguments && typeof call.arguments === "object"
              ? (call.arguments as Record<string, unknown>) : {};
            return resolveMockedCall(call.name, callArgs, get().mockReturns, get().mockErrors,
              useModelsStore.getState().config?.capabilityEndpoints ?? {});
          },
        });
        // Session was reset while the LLM call was in-flight — drop the stale
        // result rather than writing it into the freshly-cleared state.
        if (get().sessionId !== sessionId) return;
        const latencyMs = Math.round(performance.now() - t0);
        // Empty text is shown as-is — different models behave differently on
        // empty user input (GPT typically replies; Gemini returns no text).
        // The designer needs to see that, not have us hide it or guess
        // end-of-conversation.
        const agentTurn: TranscriptTurn = {
          role: "agent",
          text: res.text,
          ts: Date.now(),
          events: capabilityEvents(res.invocations, sessionId),
          latencyMs,
        };
        // An ends_conversation capability is the agent's "hang up": invoking it
        // terminates the call (tool name === capability name). Mirrors the
        // runner raising a terminal SessionEnded; stops the persona loop.
        const endsConvo = (specSnapshot?.agent.capabilities ?? []).some(
          (cap) => cap.ends_conversation && res.invocations.some((inv) => inv.name === cap.name),
        );
        set({
          transcript: [...get().transcript, agentTurn],
          lastUsage: res.usage ?? null,
          status: endsConvo ? "ended" : "ready",
          ...(endsConvo ? { autoRun: false } : {}),
        });
        // Light the graph for this turn (async, non-blocking — the reply is
        // already shown).
        void attributeTurn(set, get, sessionId);
      } catch (e) {
        // Roll back the optimistic user turn (see the runner branch) and stop
        // the persona loop. Guard against writing into state that was already
        // wiped by reset() while the LLM call was in-flight.
        if (get().sessionId !== sessionId) return;
        set({
          transcript,
          status: "error",
          error: e instanceof Error ? e.message : "Turn failed.",
          autoRun: false,
        });
      }
      return;
    }

    if (mode === "external") {
      if (!agentEntry) return;
      try {
        const t0 = performance.now();
        const res = await sendAgentTurn(agentEntry, sessionId, trimmed);
        if (get().sessionId !== sessionId) return;
        const latencyMs = Math.round(performance.now() - t0);
        const agentTurn: TranscriptTurn = {
          role: "agent",
          text: res.text,
          ts: Date.now(),
          events: [],
          latencyMs,
        };
        set({
          transcript: [...get().transcript, agentTurn],
          status: res.ended ? "ended" : "ready",
          ...(res.ended ? { autoRun: false } : {}),
        });
      } catch (e) {
        if (get().sessionId !== sessionId) return;
        set({ transcript, status: "error", error: e instanceof Error ? e.message : "Turn failed.", autoRun: false });
      }
      return;
    }

    if (!baseUrl) return;
    try {
      const t0 = performance.now();
      const res = await apiSendTurn({ baseUrl, sessionId, userText: trimmed });
      // Session was reset while the runner call was in-flight — drop the stale
      // result rather than writing it into the freshly-cleared state.
      if (get().sessionId !== sessionId) return;
      const latencyMs = Math.round(performance.now() - t0);
      const reduced = reduceEvents(
        { currentFlowId, traversedEdgeIds, traversedFlowIds, variables, status: "ready" },
        res.events,
      );
      const agentTurn: TranscriptTurn = {
        role: "agent",
        text: res.agent_text,
        ts: Date.now(),
        events: res.events,
        latencyMs,
      };
      const ended = res.ended || reduced.status === "ended";
      set({
        transcript: [...get().transcript, agentTurn],
        events: [...events, ...res.events],
        currentFlowId: reduced.currentFlowId,
        traversedEdgeIds: reduced.traversedEdgeIds,
        traversedFlowIds: reduced.traversedFlowIds,
        variables: reduced.variables,
        status: ended ? "ended" : reduced.status,
        // Runner declared the session over — stop the persona loop so the
        // Start/Stop button flips back from "Stop" to "Start".
        ...(ended ? { autoRun: false } : {}),
      });
    } catch (e) {
      // Roll back the optimistic user turn so the transcript reflects what the
      // runner actually saw, and the panel can restore it to the input for a
      // clean retry. Stop the persona loop — it can't proceed from an error.
      // Guard against writing into state that was already wiped by reset().
      if (get().sessionId !== sessionId) return;
      set({
        transcript,
        status: "error",
        error: e instanceof Error ? e.message : "Turn failed.",
        autoRun: false,
      });
    }
  },

  fork: (turnIndex) => {
    // Truncate the transcript to before the given turn, leaving the user free
    // to type a different message and continue from that point. Text mode
    // only for now: the runner is stateful, so a true fork there needs to
    // replay all prior turns into a fresh session — defer until needed.
    const { transcript, mode, status } = get();
    if (mode !== "text") return;
    if (status === "thinking" || status === "starting") return;
    if (turnIndex < 0 || turnIndex >= transcript.length) return;
    set({
      transcript: transcript.slice(0, turnIndex),
      status: "ready",
      error: null,
      autoRun: false,
      guardrailVerdict: null,
      rubricVerdicts: {},
      goldTurnVerdicts: null,
      // Invalidate any in-flight watcher (fork keeps the sessionId, so bumping
      // the seq is what drops a stale result) and clear the stale glow.
      attribution: null,
      attributionSeq: get().attributionSeq + 1,
    });
  },

  reset: async () => {
    // Caller passes the spec/key on restart via SimulatePanel; we just tear down.
    // contextVars persist across reset so designers don't lose their test setup.
    const { mode, sessionId, baseUrl } = get();
    if (mode === "runner" && sessionId && baseUrl) {
      await apiEndSession(baseUrl, sessionId);
    }
    if (voiceSession) {
      voiceSession.stop();
      voiceSession = null;
    }
    set({
      sessionId: null,
      baseUrl: null,
      status: "idle",
      transcript: [],
      events: [],
      currentFlowId: null,
      traversedEdgeIds: [],
      traversedFlowIds: [],
      variables: {},
      error: null,
      systemPrompt: null,
      specSnapshot: null,
      lastUsage: null,
      voicePhase: null,
      micMuted: false,
      autoStepping: false,
      autoRun: false,
      personaTurnsLeft: 0,
      guardrailVerdict: null,
      rubricVerdicts: {},
      goldTurnVerdicts: null,
      attribution: null,
    });
  },

}));

// Detect the [DONE] sentinel the persona generator instructs the model to emit
// when the user side wants to end the conversation. Match case-insensitively
// since the model sometimes lowercases or surrounds it with stray punctuation.
function stripDoneMarker(text: string): { text: string; done: boolean } {
  const re = /\[done\]/i;
  if (!re.test(text)) return { text: text.trim(), done: false };
  return { text: text.replace(re, "").trim(), done: true };
}

type SimulateRole = "agent" | "persona" | "extractor";

function readLlmCreds(role: SimulateRole): {
  apiKey: string;
  model: string;
  provider: ProviderId | null;
  baseUrl?: string;
  endpointLabel: string;
} {
  // Read fresh from settings on each prompt-mode turn so key/model changes
  // mid-session apply without forcing a reset.
  const s = useSettingsStore.getState();
  // The flow watcher rides the default model (no dedicated picker); the agent
  // and persona have their own per-location picks.
  const model =
    role === "persona"
      ? s.simulatePersonaModel
      : role === "extractor"
        ? s.defaultModel
        : s.simulateAgentModel;
  const dispatch = resolveDispatch(model);
  const labels: Record<string, string> = {
    google: "Google",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    "openai-compatible": "OpenAI-compatible",
  };
  return {
    apiKey: dispatch.apiKey,
    // wireModel — the actual id sent to the API. Differs from the catalog
    // key for entries that set model_id (e.g. claude-opus-4.8 →
    // anthropic/claude-opus-4.8 for OpenRouter).
    model: dispatch.wireModel,
    provider: dispatch.provider,
    baseUrl: dispatch.baseUrl,
    endpointLabel: dispatch.endpoint ? labels[dispatch.endpoint] : "provider",
  };
}

// Animate the glow THROUGH a multi-hop turn rather than snapping to the final
// flow — a turn that traverses intent → commit → unable visibly walks each node.
// Single-hop turns (the common case) settle instantly. The edge trail shows at
// once; only the node glow walks. Superseded by the next decode/reset via the
// seq + sessionId guard, so a stale walk can't write into a fresh session.
let walkTimer: ReturnType<typeof setTimeout> | null = null;
const WALK_STEP_MS = 380;

function walkPath(
  set: StoreApi<SimulateState>["setState"],
  get: StoreApi<SimulateState>["getState"],
  seq: number,
  sessionId: string,
  resolved: ResolvedPath,
): void {
  if (walkTimer) {
    clearTimeout(walkTimer);
    walkTimer = null;
  }
  set({ traversedEdgeIds: resolved.traversedEdgeIds, traversedFlowIds: resolved.traversedFlowIds });

  const flows = resolved.traversedFlowIds;
  const from = get().currentFlowId;
  const startIdx = from ? flows.lastIndexOf(from) : -1;
  const walk = flows.slice(startIdx + 1);

  // Nothing new to traverse (a stay, or the glow is already at the final flow) →
  // settle immediately.
  if (walk.length <= 1) {
    set({ currentFlowId: resolved.current.flowId, attribution: resolved.current });
    return;
  }

  let i = 0;
  const step = () => {
    walkTimer = null;
    if (get().sessionId !== sessionId || get().attributionSeq !== seq) return;
    const last = i === walk.length - 1;
    set({
      currentFlowId: walk[i],
      // Intermediates glow as a confident pass-through; the final hop carries the
      // real resolution (confidence + any illegal flag).
      attribution: last
        ? resolved.current
        : { ...resolved.current, flowId: walk[i], status: "legal", edgeId: null, exitPathId: null },
    });
    i += 1;
    if (i < walk.length) walkTimer = setTimeout(step, WALK_STEP_MS);
  };
  step();
}

// Prompt-mode graph attribution: after an agent turn lands in text mode, decode
// the whole transcript with the flow watcher (default model, structured JSON),
// resolve the path against the licensed-transition table, and write the result +
// the reused glow fields (currentFlowId / traversedEdgeIds). Fire-and-forget:
// the reply is already shown; the glow catches up ~½s later. Non-fatal on every
// failure path (no key, non-JSON provider, LLM error) — the sim just runs without
// a glow. `attributionSeq` drops a stale result when a newer turn or reset raced
// ahead; each decode re-derives the full path from the transcript, so there is
// no cross-turn state for concurrent calls to corrupt.
async function attributeTurn(
  set: StoreApi<SimulateState>["setState"],
  get: StoreApi<SimulateState>["getState"],
  sessionId: string,
): Promise<void> {
  const spec = get().specSnapshot;
  if (!spec) return;
  // User toggle (Simulate panel / settings) — off saves one LLM call per agent
  // turn (rate-limit headroom for persona batches; cost on expensive models).
  if (!useSettingsStore.getState().simulateAttribution) return;
  const creds = readLlmCreds("extractor");
  // The watcher needs strict structured JSON, which only Google/OpenAI provide
  // (the canonical predicate — same gate the persona fixture generator uses).
  // Any other provider, or a missing key → disable silently, no glow.
  if (!creds.provider || !creds.apiKey) return;
  if (!supportsStructuredOutput(useSettingsStore.getState().defaultModel)) return;

  const seq = get().attributionSeq + 1;
  set({ attributionSeq: seq });

  const table = buildTransitionTable(spec);
  const transcript = get().transcript.map((t) => ({ role: t.role, text: t.text }));

  try {
    // Decode the whole path from the whole transcript — no fed-forward prevFlow
    // (kills the auto-run staleness) and later turns fix earlier ones.
    const steps = await runFlowDecode(spec, creds.provider, creds.apiKey, creds.model, {
      transcript,
    });
    // A newer turn or a reset/fork superseded this call.
    if (get().sessionId !== sessionId || get().attributionSeq !== seq) return;
    const resolved = resolveDecodedPath(spec.agent.entry_flow_id, steps, table);
    if (!resolved) return;
    walkPath(set, get, seq, sessionId, resolved);
  } catch (e) {
    // Watcher failure is non-fatal — leave the prior glow untouched. Surface it
    // to the console so a broken decode (e.g. a schema the provider rejects)
    // isn't invisible.
    console.warn("[flow-watcher] decode failed:", e);
  }
}
