import { create } from "zustand";
import { BUILT_IN_MODELS } from "@ux4/core/files/models";

const KEY = "uxflows:settings:google_api_key";
const CHAT_MODEL_KEY = "uxflows:settings:chat_model";
const AGENT_SIMULATE_MODEL_KEY = "uxflows:settings:simulate_agent_model";
const PERSONA_SIMULATE_MODEL_KEY = "uxflows:settings:simulate_persona_model";
const RUNNER_KEY = "uxflows:settings:runner_url";
const GITHUB_PAT_KEY = "uxflows:settings:github_pat";

export const DEFAULT_RUNNER_URL = "http://localhost:8000";
const DEFAULT_MODEL_ID = BUILT_IN_MODELS.default ?? "gemini-2.5-flash";

interface SettingsState {
  googleApiKey: string;
  // Per-role model selection. Chat = LLM-assisted spec authoring (chat panel).
  // simulateAgent = the agent's side of a simulate session (prompt mode).
  // simulatePersona = the LLM-as-user persona that drives the simulate
  // panel's auto-run.
  chatModel: string;
  simulateAgentModel: string;
  simulatePersonaModel: string;
  runnerUrl: string;
  githubPat: string;
  setGoogleApiKey: (key: string) => void;
  setChatModel: (model: string) => void;
  setSimulateAgentModel: (model: string) => void;
  setSimulatePersonaModel: (model: string) => void;
  setRunnerUrl: (url: string) => void;
  setGithubPat: (pat: string) => void;
}

function persistModel(storageKey: string, model: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, model);
  } catch {
    // ignore
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  googleApiKey: "",
  chatModel: DEFAULT_MODEL_ID,
  simulateAgentModel: DEFAULT_MODEL_ID,
  simulatePersonaModel: DEFAULT_MODEL_ID,
  runnerUrl: DEFAULT_RUNNER_URL,
  githubPat: "",
  setGoogleApiKey: (key) => {
    if (typeof window !== "undefined") {
      try {
        if (key) window.localStorage.setItem(KEY, key);
        else window.localStorage.removeItem(KEY);
      } catch {
        // ignore quota or access errors
      }
    }
    set({ googleApiKey: key });
  },
  setChatModel: (model) => {
    persistModel(CHAT_MODEL_KEY, model);
    set({ chatModel: model });
  },
  setSimulateAgentModel: (model) => {
    persistModel(AGENT_SIMULATE_MODEL_KEY, model);
    set({ simulateAgentModel: model });
  },
  setSimulatePersonaModel: (model) => {
    persistModel(PERSONA_SIMULATE_MODEL_KEY, model);
    set({ simulatePersonaModel: model });
  },
  setRunnerUrl: (url) => {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (typeof window !== "undefined") {
      try {
        if (trimmed) window.localStorage.setItem(RUNNER_KEY, trimmed);
        else window.localStorage.removeItem(RUNNER_KEY);
      } catch {
        // ignore
      }
    }
    set({ runnerUrl: trimmed });
  },
  setGithubPat: (pat) => {
    const trimmed = pat.trim();
    if (typeof window !== "undefined") {
      try {
        if (trimmed) window.localStorage.setItem(GITHUB_PAT_KEY, trimmed);
        else window.localStorage.removeItem(GITHUB_PAT_KEY);
      } catch {
        // ignore
      }
    }
    set({ githubPat: trimmed });
  },
}));

export function loadSavedSettings(): void {
  if (typeof window === "undefined") return;
  try {
    const validModelIds = new Set(Object.keys(BUILT_IN_MODELS.models));
    const key = window.localStorage.getItem(KEY) ?? "";
    const chat = window.localStorage.getItem(CHAT_MODEL_KEY) ?? "";
    const simulateAgent = window.localStorage.getItem(AGENT_SIMULATE_MODEL_KEY) ?? "";
    const simulatePersona = window.localStorage.getItem(PERSONA_SIMULATE_MODEL_KEY) ?? "";
    const runner = window.localStorage.getItem(RUNNER_KEY);
    const pat = window.localStorage.getItem(GITHUB_PAT_KEY) ?? "";
    const patch: Partial<SettingsState> = {};
    if (key) patch.googleApiKey = key;
    if (chat && validModelIds.has(chat)) patch.chatModel = chat;
    if (simulateAgent && validModelIds.has(simulateAgent)) patch.simulateAgentModel = simulateAgent;
    if (simulatePersona && validModelIds.has(simulatePersona)) patch.simulatePersonaModel = simulatePersona;
    if (runner !== null) patch.runnerUrl = runner;
    if (pat) patch.githubPat = pat;
    if (Object.keys(patch).length > 0) useSettingsStore.setState(patch);
  } catch {
    // ignore
  }
}
