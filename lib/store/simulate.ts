import { create } from "zustand";
import type { Spec } from "@/lib/schema/v0";
import type { RuntimeEvent } from "@/lib/runtime/eventTypes";
import {
  endSession as apiEndSession,
  sendTurn as apiSendTurn,
  startSession as apiStartSession,
} from "@/lib/runtime/textClient";
import { sendPromptTurn } from "@/lib/runtime/promptClient";
import { generatePersonaTurn } from "@/lib/runtime/personaClient";
import { generateSystemPrompt } from "@/lib/codegen/promptGenerator";
import { cleanMockReturns } from "@/lib/runtime/capabilityMocks";
import { useSettingsStore } from "@/lib/store/settings";
import type { ChatUsage } from "@/lib/llm/types";

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

export interface TranscriptTurn {
  role: "agent" | "user";
  text: string;
  ts: number;
  events: RuntimeEvent[];
}

export interface StartArgs {
  mode: SimulateMode;
  spec: Spec;
  apiKey: string;
  model: string;
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
  lastExitEdgeId: string | null;
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

  setMode: (mode: SimulateMode) => void;
  setSystemPrompt: (prompt: string | null) => void;
  start: (args: StartArgs) => Promise<void>;
  send: (userText: string) => Promise<void>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
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
}

const CV_PREFIX = "uxflows:simulate:vars:";
const MOCKS_PREFIX = "uxflows:simulate:mocks:";
const PERSONA_PREFIX = "uxflows:simulate:persona:";

// Only the persona prompt persists across page loads. Turn limit, countdown,
// and autoRun are per-run intent — they shouldn't survive a reload.
function loadPersonaPrompt(agentId: string): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(PERSONA_PREFIX + agentId);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const p = parsed as { prompt?: unknown };
      return typeof p.prompt === "string" ? p.prompt : "";
    }
  } catch {
    // ignore
  }
  return "";
}

function savePersonaPrompt(agentId: string, prompt: string): void {
  if (typeof window === "undefined") return;
  try {
    if (!prompt) {
      window.localStorage.removeItem(PERSONA_PREFIX + agentId);
    } else {
      window.localStorage.setItem(PERSONA_PREFIX + agentId, JSON.stringify({ prompt }));
    }
  } catch {
    // ignore
  }
}

function loadVars(agentId: string): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CV_PREFIX + agentId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function saveVars(agentId: string, values: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(values).length === 0) {
      window.localStorage.removeItem(CV_PREFIX + agentId);
    } else {
      window.localStorage.setItem(CV_PREFIX + agentId, JSON.stringify(values));
    }
  } catch {
    // ignore
  }
}

function loadMocks(agentId: string): Record<string, Record<string, unknown>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MOCKS_PREFIX + agentId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, Record<string, unknown>>;
    }
  } catch {
    // ignore
  }
  return {};
}

function saveMocks(
  agentId: string,
  values: Record<string, Record<string, unknown>>,
): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(values).length === 0) {
      window.localStorage.removeItem(MOCKS_PREFIX + agentId);
    } else {
      window.localStorage.setItem(MOCKS_PREFIX + agentId, JSON.stringify(values));
    }
  } catch {
    // ignore
  }
}

function reduceEvents(
  state: Pick<SimulateState, "currentFlowId" | "lastExitEdgeId" | "variables" | "status">,
  events: RuntimeEvent[],
): Pick<SimulateState, "currentFlowId" | "lastExitEdgeId" | "variables" | "status"> {
  let { currentFlowId, lastExitEdgeId, variables, status } = state;
  for (const ev of events) {
    if (ev.type === "flow_entered") {
      currentFlowId = ev.flow_id;
    } else if (ev.type === "exit_path_taken") {
      lastExitEdgeId = `${ev.from_flow_id}__${ev.exit_path_id}`;
    } else if (ev.type === "variable_set") {
      variables = { ...variables, [ev.variable_name]: ev.value };
    } else if (ev.type === "session_ended") {
      status = "ended";
    }
  }
  return { currentFlowId, lastExitEdgeId, variables, status };
}

export const useSimulateStore = create<SimulateState>((set, get) => ({
  mode: "prompt",
  sessionId: null,
  baseUrl: null,
  status: "idle",
  transcript: [],
  events: [],
  currentFlowId: null,
  lastExitEdgeId: null,
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
  lastPersonaUsage: null,
  personaTurnLimit: 10,
  personaTurnsLeft: 0,

  setMode: (mode) => {
    if (get().sessionId) return; // mode is frozen during an active session
    set({ mode });
  },

  setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),

  hydrateContextVars: (agentId) => {
    const current = get();
    if (current.contextVarsAgentId === agentId) return;
    set({ contextVars: loadVars(agentId), contextVarsAgentId: agentId });
  },

  setContextVar: (name, value) => {
    const { contextVars, contextVarsAgentId } = get();
    const next = { ...contextVars };
    if (value === undefined || value === null || value === "") delete next[name];
    else next[name] = value;
    set({ contextVars: next });
    if (contextVarsAgentId) saveVars(contextVarsAgentId, next);
  },

  setContextVars: (values) => {
    const { contextVarsAgentId } = get();
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined || v === null || v === "") continue;
      cleaned[k] = v;
    }
    set({ contextVars: cleaned });
    if (contextVarsAgentId) saveVars(contextVarsAgentId, cleaned);
  },

  clearContextVars: () => {
    const { contextVarsAgentId } = get();
    set({ contextVars: {} });
    if (contextVarsAgentId) saveVars(contextVarsAgentId, {});
  },

  hydrateMockReturns: (agentId) => {
    const current = get();
    if (current.mockReturnsAgentId === agentId) return;
    set({ mockReturns: loadMocks(agentId), mockReturnsAgentId: agentId });
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
    if (mockReturnsAgentId) saveMocks(mockReturnsAgentId, next);
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
    if (mockReturnsAgentId) saveMocks(mockReturnsAgentId, next);
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
    if (mockReturnsAgentId) saveMocks(mockReturnsAgentId, cleaned);
  },

  clearMockReturnsForCapability: (capabilityName) => {
    const { mockReturns, mockReturnsAgentId } = get();
    if (!(capabilityName in mockReturns)) return;
    const next = { ...mockReturns };
    delete next[capabilityName];
    set({ mockReturns: next });
    if (mockReturnsAgentId) saveMocks(mockReturnsAgentId, next);
  },

  clearMockReturns: () => {
    const { mockReturnsAgentId } = get();
    set({ mockReturns: {} });
    if (mockReturnsAgentId) saveMocks(mockReturnsAgentId, {});
  },

  hydratePersona: (agentId) => {
    const current = get();
    if (current.personaAgentId === agentId) return;
    set({
      personaPrompt: loadPersonaPrompt(agentId),
      personaTurnLimit: 10,
      personaTurnsLeft: 0,
      autoRun: false,
      personaAgentId: agentId,
    });
  },

  setPersonaPrompt: (prompt) => {
    const { personaAgentId } = get();
    set({ personaPrompt: prompt });
    if (personaAgentId) savePersonaPrompt(personaAgentId, prompt);
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
    const { apiKey, model } = readLlmCreds();
    if (!apiKey) {
      set({
        autoRun: false,
        error: "Persona auto-run needs a Google API key in Settings.",
      });
      return;
    }
    set({ autoStepping: true, error: null });
    try {
      const res = await generatePersonaTurn({
        personaPrompt,
        history: transcript,
        apiKey,
        model,
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
    const { mode, spec, apiKey, model, baseUrl, language } = args;
    const { contextVars, mockReturns, systemPrompt: existingOverride } = get();
    const cleanedMocks = cleanMockReturns(mockReturns, spec);
    set({
      mode,
      status: "starting",
      transcript: [],
      events: [],
      currentFlowId: null,
      lastExitEdgeId: null,
      variables: {},
      error: null,
      sessionId: null,
      baseUrl: baseUrl ?? null,
      systemPrompt: null,
      specSnapshot: null,
      lastUsage: null,
    });

    if (mode === "prompt") {
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
          const res = await sendPromptTurn({
            systemPrompt,
            history: [],
            userText: PROMPT_MODE_BEGIN,
            apiKey,
            model,
          });
          const agentTurn: TranscriptTurn = {
            role: "agent",
            text: res.text,
            ts: Date.now(),
            events: [],
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
      const res = await apiStartSession({
        baseUrl,
        spec,
        apiKey: apiKey || undefined,
        model: model || undefined,
        language,
        contextVars,
        mockReturns: cleanedMocks,
      });
      const reduced = reduceEvents(
        { currentFlowId: null, lastExitEdgeId: null, variables: {}, status: "ready" },
        res.events,
      );
      const transcript: TranscriptTurn[] = [];
      if (res.agent_text || res.events.length > 0) {
        transcript.push({
          role: "agent",
          text: res.agent_text,
          ts: Date.now(),
          events: res.events,
        });
      }
      const ended = res.ended || reduced.status === "ended";
      set({
        sessionId: res.session_id,
        status: ended ? "ended" : reduced.status,
        transcript,
        events: res.events,
        currentFlowId: reduced.currentFlowId,
        lastExitEdgeId: reduced.lastExitEdgeId,
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
      lastExitEdgeId,
      variables,
      systemPrompt,
    } = get();
    if (!sessionId) return;
    if (status === "thinking" || status === "starting" || status === "ended") return;
    const trimmed = userText.trim();
    if (!trimmed) return;
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
        const { apiKey, model } = readLlmCreds();
        const res = await sendPromptTurn({
          systemPrompt: systemPrompt ?? "",
          history: transcript,
          userText: trimmed,
          apiKey,
          model,
        });
        // Empty text means Gemini returned STOP with no parts — the model is
        // signaling the conversation is over. Skip the empty agent bubble and
        // end the session.
        if (!res.text) {
          set({
            lastUsage: res.usage ?? null,
            status: "ended",
            autoRun: false,
          });
          return;
        }
        const agentTurn: TranscriptTurn = {
          role: "agent",
          text: res.text,
          ts: Date.now(),
          events: [],
        };
        set({
          transcript: [...get().transcript, agentTurn],
          lastUsage: res.usage ?? null,
          status: "ready",
        });
      } catch (e) {
        set({
          status: "error",
          error: e instanceof Error ? e.message : "Turn failed.",
        });
      }
      return;
    }

    if (!baseUrl) return;
    try {
      const res = await apiSendTurn({ baseUrl, sessionId, userText: trimmed });
      const reduced = reduceEvents(
        { currentFlowId, lastExitEdgeId, variables, status: "ready" },
        res.events,
      );
      const agentTurn: TranscriptTurn = {
        role: "agent",
        text: res.agent_text,
        ts: Date.now(),
        events: res.events,
      };
      const ended = res.ended || reduced.status === "ended";
      set({
        transcript: [...get().transcript, agentTurn],
        events: [...events, ...res.events],
        currentFlowId: reduced.currentFlowId,
        lastExitEdgeId: reduced.lastExitEdgeId,
        variables: reduced.variables,
        status: ended ? "ended" : reduced.status,
        // Runner declared the session over — stop the persona loop so the
        // Start/Stop button flips back from "Stop" to "Start".
        ...(ended ? { autoRun: false } : {}),
      });
    } catch (e) {
      set({
        status: "error",
        error: e instanceof Error ? e.message : "Turn failed.",
      });
    }
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
      lastExitEdgeId: null,
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

  close: async () => {
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
      lastExitEdgeId: null,
      variables: {},
      error: null,
      systemPrompt: null,
      specSnapshot: null,
      lastUsage: null,
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

function readLlmCreds(): { apiKey: string; model: string } {
  // Read fresh from settings on each prompt-mode turn so key/model changes
  // mid-session apply without forcing a reset.
  const s = useSettingsStore.getState();
  return { apiKey: s.googleApiKey, model: s.googleModel };
}
