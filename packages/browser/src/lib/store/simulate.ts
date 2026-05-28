import { create } from "zustand";
import type { Spec } from "@flowstore/core/schema/v0";
import type { RuntimeEvent } from "@flowstore/core/runtime/eventTypes";
import { type TranscriptTurn } from "@flowstore/core/runtime/transcript";
import {
  endSession as apiEndSession,
  sendTurn as apiSendTurn,
  startSession as apiStartSession,
} from "@flowstore/core/runtime/textClient";
import { sendPromptTurn, type CapabilityInvocation } from "@flowstore/core/runtime/promptClient";
import { generatePersonaTurn } from "@flowstore/core/runtime/personaClient";
import { generateSystemPrompt } from "@flowstore/core/codegen/promptGenerator";
import {
  buildCapabilityTools,
  cleanMockReturns,
  resolveMockedCall,
} from "@flowstore/core/runtime/capabilityMocks";
import { resolveDispatch, useSettingsStore } from "@/lib/store/settings";
import { useUiStore } from "@/lib/store/ui";
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

export type SimulateMode = "runner" | "prompt";

// Synthetic user turn that elicits the agent's opener when chatbot_initiates
// is true in prompt mode. The Gemini API requires at least one user content;
// the system prompt is what shapes the actual greeting.
const PROMPT_MODE_BEGIN = "[begin]";

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
  // null when settings doesn't yet have a provider for the chosen model (no
  // key configured). Prompt mode rejects with a clear error in that case;
  // runner mode passes apiKey through to the Python side regardless.
  provider: ProviderId | null;
  // baseUrl from settings.resolveDispatch — only meaningful for the
  // openai-compatible adapter path (OpenRouter today).
  baseUrl?: string;
  language?: string;
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
  contextVars: Record<string, unknown>;
  contextVarsAgentId: string | null;
  mockReturns: Record<string, Record<string, unknown>>;
  mockReturnsAgentId: string | null;
  error: string | null;
  // Prompt-mode state. Frozen at session start; reset clears.
  systemPrompt: string | null;
  specSnapshot: Spec | null;
  lastUsage: ChatUsage | null;
  // Persona auto-play state. Only personaPrompt persists per agent (in
  // localStorage); everything else is per-session intent. autoStepping is the
  // in-flight guard that prevents the panel effect from re-firing.
  personaPrompt: string;
  autoRun: boolean;
  personaAgentId: string | null;
  autoStepping: boolean;
  // personaTurnLimit is the input value: how many turns the next Start grants.
  // personaTurnsLeft is the live countdown for the current run; reaches 0 → loop stops.
  // Both in-memory; each Start refills.
  personaTurnLimit: number;
  personaTurnsLeft: number;
  // Active-case binding. Set when the designer clicks "Open in Sim ▶"
  // on a saved test case (or selects one from the SimulatePanel's
  // Load-case picker). null = free-play mode. Drives the active-case
  // header strip, the ▶ Run case button, and inline per-turn assertion
  // verdicts in the transcript.
  activeCaseId: string | null;

  setMode: (mode: SimulateMode) => void;
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
  clearMockReturnsForCapability: (capabilityName: string) => void;
  clearMockReturns: () => void;
  hydratePersona: (agentId: string) => void;
  setPersonaPrompt: (prompt: string) => void;
  setAutoRun: (on: boolean) => void;
  setPersonaTurnLimit: (n: number) => void;
  autoStep: () => Promise<void>;
  setActiveCaseId: (id: string | null) => void;
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

export const useSimulateStore = create<SimulateState>((set, get) => ({
  mode: "prompt",
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
  mockReturnsAgentId: null,
  error: null,
  systemPrompt: null,
  specSnapshot: null,
  lastUsage: null,
  personaPrompt: "",
  autoRun: false,
  personaAgentId: null,
  autoStepping: false,
  personaTurnLimit: 10,
  personaTurnsLeft: 0,
  activeCaseId: null,

  setMode: (mode) => {
    if (get().sessionId) return; // mode is frozen during an active session
    set({ mode });
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
    const { mockReturns, mockReturnsAgentId } = get();
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
    set({ mockReturns: next });
    if (mockReturnsAgentId) mocksStorage.save(mockReturnsAgentId, next);
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
    const { mockReturns, mockReturnsAgentId } = get();
    if (!(capabilityName in mockReturns)) return;
    const next = { ...mockReturns };
    delete next[capabilityName];
    set({ mockReturns: next });
    if (mockReturnsAgentId) mocksStorage.save(mockReturnsAgentId, next);
  },

  clearMockReturns: () => {
    const { mockReturns, mockReturnsAgentId } = get();
    if (Object.keys(mockReturns).length === 0) return;
    set({ mockReturns: {} });
    if (mockReturnsAgentId) mocksStorage.save(mockReturnsAgentId, {});
  },

  hydratePersona: (agentId) => {
    const current = get();
    if (current.personaAgentId === agentId) return;
    set({
      personaPrompt: personaStorage.load(agentId).prompt,
      personaTurnLimit: 10,
      personaTurnsLeft: 0,
      autoRun: false,
      personaAgentId: agentId,
    });
  },

  setPersonaPrompt: (prompt) => {
    const { personaAgentId } = get();
    set({ personaPrompt: prompt });
    if (personaAgentId) personaStorage.save(personaAgentId, { prompt });
  },

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
    set({ activeCaseId: id });
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
      const res = await generatePersonaTurn({
        personaPrompt,
        history: transcript,
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
        // Delegate to send() so the user turn goes through the same path
        // (handles prompt vs runner, transcript bookkeeping, error state).
        await get().send(cleaned);
        set({ personaTurnsLeft: get().personaTurnsLeft - 1 });
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
    const { mode, spec, apiKey, model, provider, baseUrl, language } = args;
    const { contextVars, mockReturns } = get();
    // The editable prompt override is produced by the Prompt panel and lives in
    // the ui store; use it if present, else compile fresh from the spec.
    const existingOverride = useUiStore.getState().promptOverride;
    const cleanedMocks = cleanMockReturns(mockReturns, spec);
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
      systemPrompt: null,
      specSnapshot: null,
      lastUsage: null,
    });

    if (mode === "prompt") {
      if (!provider || !apiKey) {
        set({
          status: "error",
          error: "Prompt-mode session needs an API key for the selected model. Add it in Settings.",
        });
        return;
      }
      try {
        const systemPrompt =
          existingOverride ?? generateSystemPrompt(spec, contextVars, { language });
        const sessionId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set({ sessionId, systemPrompt, specSnapshot: spec });

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
            resolveTool: (call) => resolveMockedCall(call.name, get().mockReturns),
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
        language,
        contextVars,
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
    if (status === "thinking" || status === "starting" || status === "ended") return;
    // Empty user text is allowed — sent verbatim so designers can see how
    // each model actually reacts to no input (GPT replies; Gemini returns no
    // text). No rewriting, no magic markers.
    const trimmed = userText.trim();
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
    });

    if (mode === "prompt") {
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
          resolveTool: (call) => resolveMockedCall(call.name, get().mockReturns),
        });
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
        set({
          transcript: [...get().transcript, agentTurn],
          lastUsage: res.usage ?? null,
          status: "ready",
        });
      } catch (e) {
        // Roll back the optimistic user turn (see the runner branch) and stop
        // the persona loop.
        set({
          transcript,
          status: "error",
          error: e instanceof Error ? e.message : "Turn failed.",
          autoRun: false,
        });
      }
      return;
    }

    if (!baseUrl) return;
    try {
      const t0 = performance.now();
      const res = await apiSendTurn({ baseUrl, sessionId, userText: trimmed });
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
    // to type a different message and continue from that point. Prompt mode
    // only for now: the runner is stateful, so a true fork there needs to
    // replay all prior turns into a fresh session — defer until needed.
    const { transcript, mode, status } = get();
    if (mode !== "prompt") return;
    if (status === "thinking" || status === "starting") return;
    if (turnIndex < 0 || turnIndex >= transcript.length) return;
    set({
      transcript: transcript.slice(0, turnIndex),
      status: "ready",
      error: null,
      autoRun: false,
    });
  },

  reset: async () => {
    // Caller passes the spec/key on restart via SimulatePanel; we just tear down.
    // contextVars persist across reset so designers don't lose their test setup.
    const { mode, sessionId, baseUrl } = get();
    if (mode === "runner" && sessionId && baseUrl) {
      await apiEndSession(baseUrl, sessionId);
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
      autoStepping: false,
      autoRun: false,
      personaTurnsLeft: 0,
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

type SimulateRole = "agent" | "persona";

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
  const model = role === "persona" ? s.simulatePersonaModel : s.simulateAgentModel;
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
