import { create } from "zustand";
import type { Spec } from "@/lib/schema/v0";
import type { RuntimeEvent } from "@/lib/runtime/eventTypes";
import {
  endSession as apiEndSession,
  sendTurn as apiSendTurn,
  startSession as apiStartSession,
} from "@/lib/runtime/textClient";

export type SimulateStatus =
  | "idle"
  | "starting"
  | "ready"
  | "thinking"
  | "ended"
  | "error";

export interface TranscriptTurn {
  role: "agent" | "user";
  text: string;
  ts: number;
  events: RuntimeEvent[];
}

interface SimulateState {
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
  error: string | null;

  start: (
    baseUrl: string,
    spec: Spec,
    apiKey: string,
    model: string,
    language?: string,
  ) => Promise<void>;
  send: (userText: string) => Promise<void>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
  hydrateContextVars: (agentId: string) => void;
  setContextVar: (name: string, value: unknown) => void;
  setContextVars: (values: Record<string, unknown>) => void;
  clearContextVars: () => void;
}

const CV_PREFIX = "uxflows:simulate:vars:";

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
  error: null,

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

  start: async (baseUrl, spec, apiKey, model, language) => {
    const { contextVars } = get();
    set({
      status: "starting",
      transcript: [],
      events: [],
      currentFlowId: null,
      lastExitEdgeId: null,
      variables: {},
      error: null,
      sessionId: null,
      baseUrl,
    });
    try {
      const res = await apiStartSession({
        baseUrl,
        spec,
        apiKey: apiKey || undefined,
        model: model || undefined,
        language,
        contextVars,
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
      set({
        sessionId: res.session_id,
        status: res.ended ? "ended" : reduced.status,
        transcript,
        events: res.events,
        currentFlowId: reduced.currentFlowId,
        lastExitEdgeId: reduced.lastExitEdgeId,
        variables: reduced.variables,
        error: null,
      });
    } catch (e) {
      set({
        status: "error",
        error: e instanceof Error ? e.message : "Failed to start session.",
      });
    }
  },

  send: async (userText) => {
    const { sessionId, baseUrl, status, transcript, events, currentFlowId, lastExitEdgeId, variables } = get();
    if (!sessionId || !baseUrl) return;
    if (status === "thinking" || status === "starting" || status === "ended") return;
    const trimmed = userText.trim();
    if (!trimmed) return;
    const userTurn: TranscriptTurn = {
      role: "user",
      text: trimmed,
      ts: Date.now(),
      events: [],
    };
    set({
      status: "thinking",
      transcript: [...transcript, userTurn],
      error: null,
    });
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
      set({
        transcript: [...get().transcript, agentTurn],
        events: [...events, ...res.events],
        currentFlowId: reduced.currentFlowId,
        lastExitEdgeId: reduced.lastExitEdgeId,
        variables: reduced.variables,
        status: res.ended ? "ended" : reduced.status,
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
    const { sessionId, baseUrl } = get();
    if (sessionId && baseUrl) {
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
    });
  },

  close: async () => {
    const { sessionId, baseUrl } = get();
    if (sessionId && baseUrl) {
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
    });
  },
}));
