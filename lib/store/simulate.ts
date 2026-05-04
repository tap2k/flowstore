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
  variables: Record<string, unknown>;
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
}

function reduceEvents(
  state: Pick<SimulateState, "currentFlowId" | "variables" | "status">,
  events: RuntimeEvent[],
): Pick<SimulateState, "currentFlowId" | "variables" | "status"> {
  let { currentFlowId, variables, status } = state;
  for (const ev of events) {
    if (ev.type === "flow_entered") {
      currentFlowId = ev.flow_id;
    } else if (ev.type === "variable_set") {
      variables = { ...variables, [ev.variable_name]: ev.value };
    } else if (ev.type === "session_ended") {
      status = "ended";
    }
  }
  return { currentFlowId, variables, status };
}

export const useSimulateStore = create<SimulateState>((set, get) => ({
  sessionId: null,
  baseUrl: null,
  status: "idle",
  transcript: [],
  events: [],
  currentFlowId: null,
  variables: {},
  error: null,

  start: async (baseUrl, spec, apiKey, model, language) => {
    set({
      status: "starting",
      transcript: [],
      events: [],
      currentFlowId: null,
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
      });
      const reduced = reduceEvents(
        { currentFlowId: null, variables: {}, status: "ready" },
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
    const { sessionId, baseUrl, status, transcript, events, currentFlowId, variables } = get();
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
        { currentFlowId, variables, status: "ready" },
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
      variables: {},
      error: null,
    });
  },
}));
