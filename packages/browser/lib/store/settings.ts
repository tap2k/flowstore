import { create } from "zustand";
import { BUILT_IN_MODELS, resolveEndpoint, wireModelId } from "@ux4/core/files/models";
import type { EndpointId } from "@ux4/core/files/models";
import type { ProviderId } from "@ux4/core/llm/types";

const KEY = "uxflows:settings:google_api_key";
const OPENAI_KEY = "uxflows:settings:openai_api_key";
const OPENROUTER_KEY = "uxflows:settings:openrouter_api_key";
const CHAT_MODEL_KEY = "uxflows:settings:chat_model";
const AGENT_SIMULATE_MODEL_KEY = "uxflows:settings:simulate_agent_model";
const PERSONA_SIMULATE_MODEL_KEY = "uxflows:settings:simulate_persona_model";
const RUNNER_KEY = "uxflows:settings:runner_url";
const GITHUB_PAT_KEY = "uxflows:settings:github_pat";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_RUNNER_URL = "http://localhost:8000";
const DEFAULT_MODEL_ID = BUILT_IN_MODELS.default ?? "gemini-2.5-flash";

interface SettingsState {
  googleApiKey: string;
  openaiApiKey: string;
  openrouterApiKey: string;
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
  setOpenaiApiKey: (key: string) => void;
  setOpenrouterApiKey: (key: string) => void;
  setChatModel: (model: string) => void;
  setSimulateAgentModel: (model: string) => void;
  setSimulatePersonaModel: (model: string) => void;
  setRunnerUrl: (url: string) => void;
  setGithubPat: (pat: string) => void;
}

// Resolved dispatch parameters for a given catalog key. `wireModel` is the
// id sent to the API (entry.model_id when set, else the catalog key).
// baseUrl is populated for openrouter/openai-compatible; provider is null
// when neither the id nor an explicit entry tells us which adapter to use
// (developer-added model with no endpoint and unrecognized prefix — caller
// surfaces the error).
export type ResolvedDispatch = {
  provider: ProviderId | null;
  apiKey: string;
  baseUrl?: string;
  endpoint: EndpointId | null;
  wireModel: string;
};

function persistString(storageKey: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(storageKey, value);
    else window.localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  googleApiKey: "",
  openaiApiKey: "",
  openrouterApiKey: "",
  chatModel: DEFAULT_MODEL_ID,
  simulateAgentModel: DEFAULT_MODEL_ID,
  simulatePersonaModel: DEFAULT_MODEL_ID,
  runnerUrl: DEFAULT_RUNNER_URL,
  githubPat: "",
  setGoogleApiKey: (key) => {
    persistString(KEY, key);
    set({ googleApiKey: key });
  },
  setOpenaiApiKey: (key) => {
    persistString(OPENAI_KEY, key);
    set({ openaiApiKey: key });
  },
  setOpenrouterApiKey: (key) => {
    persistString(OPENROUTER_KEY, key);
    set({ openrouterApiKey: key });
  },
  setChatModel: (model) => {
    persistString(CHAT_MODEL_KEY, model);
    set({ chatModel: model });
  },
  setSimulateAgentModel: (model) => {
    persistString(AGENT_SIMULATE_MODEL_KEY, model);
    set({ simulateAgentModel: model });
  },
  setSimulatePersonaModel: (model) => {
    persistString(PERSONA_SIMULATE_MODEL_KEY, model);
    set({ simulatePersonaModel: model });
  },
  setRunnerUrl: (url) => {
    const trimmed = url.trim().replace(/\/+$/, "");
    persistString(RUNNER_KEY, trimmed);
    set({ runnerUrl: trimmed });
  },
  setGithubPat: (pat) => {
    const trimmed = pat.trim();
    persistString(GITHUB_PAT_KEY, trimmed);
    set({ githubPat: trimmed });
  },
}));

// Look up the dispatch parameters for a given model id, consulting
// BUILT_IN_MODELS for endpoint inference. Returns the provider, the API
// key from settings, and (for openai-compatible hosts) the base URL.
// Reads settings imperatively — call from event handlers, not during render.
//
// Project-level models config (`models/*.json`) entries aren't consulted
// here yet — the editor still reads only the built-in catalog. When
// project-level model dispatch lands, pass the resolved entry through.
export function resolveDispatch(modelId: string): ResolvedDispatch {
  const builtinEntry = BUILT_IN_MODELS.models[modelId];
  const endpoint = resolveEndpoint(modelId, builtinEntry);
  const wireModel = wireModelId(modelId, builtinEntry);
  const s = useSettingsStore.getState();
  switch (endpoint) {
    case "google":
      return { provider: "google", apiKey: s.googleApiKey, endpoint, wireModel };
    case "openai":
      return { provider: "openai", apiKey: s.openaiApiKey, endpoint, wireModel };
    case "openrouter":
      return {
        provider: "openai-compatible",
        apiKey: s.openrouterApiKey,
        baseUrl: OPENROUTER_BASE_URL,
        endpoint,
        wireModel,
      };
    case "openai-compatible":
      // Catchall — base_url must come from the entry; key has no settings
      // slot today.
      return { provider: "openai-compatible", apiKey: "", endpoint, wireModel };
    default:
      return { provider: null, apiKey: "", endpoint: null, wireModel };
  }
}

// True iff settings carries a key for the model's endpoint. Used by the
// model picker to filter out models the user can't dispatch.
export function hasKeyForModel(modelId: string): boolean {
  const r = resolveDispatch(modelId);
  return !!r.apiKey;
}

export function loadSavedSettings(): void {
  if (typeof window === "undefined") return;
  try {
    const validModelIds = new Set(Object.keys(BUILT_IN_MODELS.models));
    const googleKey = window.localStorage.getItem(KEY) ?? "";
    const openaiKey = window.localStorage.getItem(OPENAI_KEY) ?? "";
    const openrouterKey = window.localStorage.getItem(OPENROUTER_KEY) ?? "";
    const chat = window.localStorage.getItem(CHAT_MODEL_KEY) ?? "";
    const simulateAgent = window.localStorage.getItem(AGENT_SIMULATE_MODEL_KEY) ?? "";
    const simulatePersona = window.localStorage.getItem(PERSONA_SIMULATE_MODEL_KEY) ?? "";
    const runner = window.localStorage.getItem(RUNNER_KEY);
    const pat = window.localStorage.getItem(GITHUB_PAT_KEY) ?? "";
    const patch: Partial<SettingsState> = {};
    if (googleKey) patch.googleApiKey = googleKey;
    if (openaiKey) patch.openaiApiKey = openaiKey;
    if (openrouterKey) patch.openrouterApiKey = openrouterKey;
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

// Hydrate at module load time, not just inside one mount effect. When Next's
// HMR re-evaluates this module the zustand store starts empty; without this
// call the page-level effect doesn't re-run and the user sees blank PAT /
// API key fields until the next save.
if (typeof window !== "undefined") loadSavedSettings();
