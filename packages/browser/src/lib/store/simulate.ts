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
import type { GuardrailVerdict } from "@flowstore/core/runtime/judgeGuardrails";
import type { RubricVerdict } from "@flowstore/core/runtime/judgeRubric";
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

// "text" and "voice" are both browser-direct prompt mode (compiled monolith
// system prompt, capability mocks, no Python runner) — they differ only in
// transport (turn-based HTTP vs. a Gemini Live bidi audio socket). "runner"
// drives the Python per-flow runtime. isPromptMode groups the two browser-
// direct modes for the UI/state checks that apply to both.
export type SimulateMode = "text" | "voice" | "runner";

export const isPromptMode = (m: SimulateMode): boolean => m !== "runner";

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
  // Sentinels for error-behavior mocks. When mockErrors[capabilityName]
  // is set, the resolver throws (or returns an error result) instead of
  // the static returns. Per-capability mutually exclusive with mockReturns
  // — setting one clears the other for that capability.
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
  // Mic mute toggle for voice mode. Gates audio emission without tearing the
  // capture graph down (no re-prompt for permission).
  micMuted: boolean;
  // Persona auto-play state. Only personaPrompt persists per agent (in
  // localStorage); everything else is per-session intent. autoStepping is the
  // in-flight guard that prevents the panel effect from re-firing.
  personaPrompt: string;
  // Open behavioral knobs of the loaded persona, rendered into the user-sim
  // prompt at run time (see generatePersonaTurn). Set only when a persona is
  // loaded from a Persona object; the free-text prompt buffer carries none.
  // Per-session, not persisted — re-pick the persona to reload.
  personaTraits?: Record<string, string | number | boolean>;
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
  // Active-gold binding. Set when the designer clicks "▶ Run" on a saved
  // gold in the Golds tab. Mutually exclusive with activeCaseId (setting
  // one clears the other) — the Simulate tab shows at most one active
  // strip. Drives the active-gold header strip, the ▶ Run gold button, and
  // the turn-aligned gold-vs-live comparison card. In-memory only: a gold
  // run is a quick action, not a binding worth surviving a reload.
  activeGoldId: string | null;
  // Language scope for the current session. undefined = "auto": the prompt
  // renders in the default language and voice auto-detects, following the
  // caller per turn. A specific code pins scripts/FAQ to that bucket and (in
  // voice) hints transcription/speech to that language. Lifted from
  // SimulatePanel's prior useState so a Tests-tab "Open in Sim" can override
  // the picker from case.language.
  language: string | undefined;

  // Evaluation results for the current transcript. Lifted out of
  // SimulatePanel local state so the ChatPanel (and anything else) can read
  // them without recomputing. Both go stale the moment the conversation
  // continues, so start/reset/send/fork clear them. guardrailVerdict is the
  // holistic "Evaluate" result (judgeGuardrails); rubricVerdicts is keyed by
  // rubric id, with "pending" while a judge call is in flight.
  guardrailVerdict: GuardrailVerdict | null;
  rubricVerdicts: Record<string, RubricVerdict | "pending">;

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
  // Mark a capability as error-behavior. Clears any static returns for
  // that capability. Pass null to revert to static-behavior (clears the
  // error sentinel; existing mockReturns become live again).
  setMockError: (capabilityName: string, error: string | null) => void;
  clearMockReturnsForCapability: (capabilityName: string) => void;
  clearMockReturns: () => void;
  hydratePersona: (agentId: string) => void;
  setPersonaPrompt: (prompt: string) => void;
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

// Active-case binding is the one bit of this otherwise-runtime store worth
// surviving a reload (and an HMR module re-eval). It's a single global value,
// so it gets a lightweight read/write rather than wrapping the whole store in
// persist; hydration is inline in the initial state below, which re-runs on
// every module re-eval — the same module-load-time trick settings.ts uses. The
// transcript / sessionId / events are runtime artifacts and re-derive from the
// next Run.
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
  personaTurnLimit: 10,
  personaTurnsLeft: 0,
  activeCaseId: loadActiveCaseId(),
  activeGoldId: null,
  language: undefined,
  guardrailVerdict: null,
  rubricVerdicts: {},

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
    set({ personaPrompt: prompt });
    if (personaAgentId) personaStorage.save(personaAgentId, { prompt });
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
    set({ activeGoldId: id, ...(id ? { activeCaseId: null } : {}) });
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

  clearEvaluation: () => {
    set({ guardrailVerdict: null, rubricVerdicts: {} });
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
      if (get().mode === "text" && bargeVoice && lastTurn?.role === "agent" && lastTurn.text) {
        const heard = maybeBargeIn(lastTurn.text, bargeProp);
        if (heard !== null) {
          history = [...transcript.slice(0, -1), { ...lastTurn, text: heard }];
          set({ transcript: history });
        }
      }
      const res = await generatePersonaTurn({
        personaPrompt,
        // The medium-aware rail follows the running session's modality.
        modality: get().specSnapshot?.agent.meta.modality ?? "text",
        history,
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
        const asr = get().personaTraits?.asr;
        const asrLevel: AsrLevel =
          asr === "clean" || asr === "light" || asr === "heavy" ? asr : "off";
        const meta = get().specSnapshot?.agent.meta;
        const voiceish = meta?.modality === "voice" || meta?.modality === "multimodal";
        const toSend =
          voiceish && asrLevel !== "off"
            ? asrShape(cleaned, asrLevel, get().language ?? meta?.languages?.[0] ?? "EN")
            : cleaned;
        // Delegate to send() so the user turn goes through the same path
        // (handles prompt vs runner, transcript bookkeeping, error state).
        await get().send(toSend);
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
      systemPrompt: null,
      specSnapshot: null,
      lastUsage: null,
      voicePhase: null,
      micMuted: false,
      guardrailVerdict: null,
      rubricVerdicts: {},
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
          generateSystemPrompt(spec, contextVars, { language: language ?? ALL_LANGUAGES });
        const sessionId = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set({ sessionId, systemPrompt, specSnapshot: spec });
        const { VoiceSession } = await import("@/lib/runtime/voiceSession");
        const session = new VoiceSession({
          apiKey,
          model,
          systemPrompt,
          tools: buildCapabilityTools(spec),
          resolveTool: (name) =>
            resolveMockedCall(name, get().mockReturns, get().mockErrors),
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
          generateSystemPrompt(spec, contextVars, { language: language ?? ALL_LANGUAGES });
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
            resolveTool: (call) =>
              resolveMockedCall(call.name, get().mockReturns, get().mockErrors),
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
        // Omit when unpinned → runner emits every declared language.
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
    // Voice is mic-driven full-duplex — there are no typed user turns to send.
    if (mode === "voice") return;
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
      // The conversation moved on — any prior evaluation is now stale.
      guardrailVerdict: null,
      rubricVerdicts: {},
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
