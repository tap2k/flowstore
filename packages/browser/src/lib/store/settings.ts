import { create } from "zustand";
import { BUILT_IN_MODELS, resolveEndpoint, wireModelId } from "@flowstore/core/files/models";
import type { EndpointId } from "@flowstore/core/files/models";
import type { ProviderId } from "@flowstore/core/llm/types";

const KEY = "flowstore:settings:google_api_key";
const OPENAI_KEY = "flowstore:settings:openai_api_key";
const OPENROUTER_KEY = "flowstore:settings:openrouter_api_key";
const DEFAULT_MODEL_KEY = "flowstore:settings:default_model";
const RUNNER_KEY = "flowstore:settings:runner_url";
const GITHUB_PAT_KEY = "flowstore:settings:github_pat";
const GITHUB_LOGIN_KEY = "flowstore:settings:github_login";
const GITHUB_NAME_KEY = "flowstore:settings:github_name";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

// Used as the input placeholder in the Settings sheet — the actual stored
// value starts empty so an empty field communicates "configure to enable
// runner mode" rather than "this is set, ready to go."
export const DEFAULT_RUNNER_URL = "http://localhost:8000";
export const DEFAULT_MODEL_ID = BUILT_IN_MODELS.default ?? "gemini-2.5-flash";

interface SettingsState {
  googleApiKey: string;
  openaiApiKey: string;
  openrouterApiKey: string;
  // defaultModel is the ONE persisted model choice: the value used wherever
  // no explicit per-location pick is made (Generate vars/mocks/persona-from-
  // name+notes; Translate). Must be structured-output-capable (Google Gemini
  // or OpenAI) — strict-schema is the contract.
  defaultModel: string;
  // The four per-location picks are transient — seeded from defaultModel on
  // load, overridable in their UI spot for the session, never persisted and
  // never written to the project (git) envelope. chat = spec-authoring chat
  // panel. simulateAgent = the agent's side of a simulate session (prompt
  // mode). simulatePersona = the LLM-as-user that drives auto-run.
  // simulateJudge = LLM-judge for rubric/guardrail scoring.
  chatModel: string;
  simulateAgentModel: string;
  simulatePersonaModel: string;
  simulateJudgeModel: string;
  runnerUrl: string;
  githubPat: string;
  // Identity echoed from `GET /user` after a PAT is set. Used by Comments
  // for author display. Both undefined until a PAT is configured and the
  // echo succeeds. Cleared if the PAT is removed or the echo fails.
  githubLogin: string;
  githubName: string;
  setGoogleApiKey: (key: string) => void;
  setOpenaiApiKey: (key: string) => void;
  setOpenrouterApiKey: (key: string) => void;
  setChatModel: (model: string) => void;
  setSimulateAgentModel: (model: string) => void;
  setSimulatePersonaModel: (model: string) => void;
  setSimulateJudgeModel: (model: string) => void;
  setGenerateModel: (model: string) => void;
  setRunnerUrl: (url: string) => void;
  setGithubPat: (pat: string) => void;
  setGithubIdentity: (login: string, name: string) => void;
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
  simulateJudgeModel: DEFAULT_MODEL_ID,
  defaultModel: DEFAULT_MODEL_ID,
  runnerUrl: "",
  githubPat: "",
  githubLogin: "",
  githubName: "",
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
  // Per-location picks are transient — set in memory only, no persistString.
  setChatModel: (model) => set({ chatModel: model }),
  setSimulateAgentModel: (model) => set({ simulateAgentModel: model }),
  setSimulatePersonaModel: (model) => set({ simulatePersonaModel: model }),
  setSimulateJudgeModel: (model) => set({ simulateJudgeModel: model }),
  setGenerateModel: (model) => {
    persistString(DEFAULT_MODEL_KEY, model);
    set({ defaultModel: model });
  },
  setRunnerUrl: (url) => {
    const trimmed = url.trim().replace(/\/+$/, "");
    persistString(RUNNER_KEY, trimmed);
    set({ runnerUrl: trimmed });
  },
  setGithubPat: (pat) => {
    const trimmed = pat.trim();
    persistString(GITHUB_PAT_KEY, trimmed);
    if (!trimmed) {
      persistString(GITHUB_LOGIN_KEY, "");
      persistString(GITHUB_NAME_KEY, "");
      set({ githubPat: "", githubLogin: "", githubName: "" });
      return;
    }
    set({ githubPat: trimmed });
    // Fire-and-forget identity echo. setGithubIdentity stays cached even
    // if this fails; user sees the previous login until the next
    // successful echo. Imported lazily so PAT-less builds don't pull
    // octokit on initial paint.
    void fetchAndSetGithubIdentity(trimmed);
  },
  setGithubIdentity: (login, name) => {
    persistString(GITHUB_LOGIN_KEY, login);
    persistString(GITHUB_NAME_KEY, name);
    set({ githubLogin: login, githubName: name });
  },
}));

async function fetchAndSetGithubIdentity(pat: string): Promise<void> {
  try {
    const { makeGitHubClient } = await import("@flowstore/core/files/github");
    const client = makeGitHubClient(pat);
    const res = await client.rest.users.getAuthenticated();
    const login = res.data.login ?? "";
    const name = res.data.name ?? "";
    useSettingsStore.getState().setGithubIdentity(login, name);
  } catch {
    // Network or auth failure — keep whatever's currently cached.
  }
}

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

// Providers whose adapter implements strict structured output
// (generateStructuredJson). OpenRouter / openai-compatible bare models don't,
// so models that resolve to them can't back schema-constrained generation.
const STRUCTURED_OUTPUT_PROVIDERS: ReadonlySet<ProviderId> = new Set([
  "google",
  "openai",
]);

// True iff the model dispatches to a provider that supports strict structured
// output. Mirrors generateStructuredJson's provider switch so the picker
// filter can't drift from what the runtime actually supports.
export function supportsStructuredOutput(modelId: string): boolean {
  const p = resolveDispatch(modelId).provider;
  return p !== null && STRUCTURED_OUTPUT_PROVIDERS.has(p);
}

export function loadSavedSettings(): void {
  if (typeof window === "undefined") return;
  try {
    const validModelIds = new Set(Object.keys(BUILT_IN_MODELS.models));
    const googleKey = window.localStorage.getItem(KEY) ?? "";
    const openaiKey = window.localStorage.getItem(OPENAI_KEY) ?? "";
    const openrouterKey = window.localStorage.getItem(OPENROUTER_KEY) ?? "";
    const defaultModel = window.localStorage.getItem(DEFAULT_MODEL_KEY) ?? "";
    const runner = window.localStorage.getItem(RUNNER_KEY);
    const pat = window.localStorage.getItem(GITHUB_PAT_KEY) ?? "";
    const login = window.localStorage.getItem(GITHUB_LOGIN_KEY) ?? "";
    const name = window.localStorage.getItem(GITHUB_NAME_KEY) ?? "";
    const patch: Partial<SettingsState> = {};
    if (googleKey) patch.googleApiKey = googleKey;
    if (openaiKey) patch.openaiApiKey = openaiKey;
    if (openrouterKey) patch.openrouterApiKey = openrouterKey;
    // Only defaultModel persists. Seed the transient per-location picks from
    // it so they all start on the user's default until overridden in-session.
    if (defaultModel && validModelIds.has(defaultModel)) {
      patch.defaultModel = defaultModel;
      patch.chatModel = defaultModel;
      patch.simulateAgentModel = defaultModel;
      patch.simulatePersonaModel = defaultModel;
      patch.simulateJudgeModel = defaultModel;
    }
    if (runner !== null) patch.runnerUrl = runner;
    if (pat) patch.githubPat = pat;
    if (login) patch.githubLogin = login;
    if (name) patch.githubName = name;
    if (Object.keys(patch).length > 0) useSettingsStore.setState(patch);
    // First-load-after-upgrade: PAT cached from before identity was a
    // concept. Fire the echo so the user gets a real login on next
    // comment without re-pasting the PAT.
    if (pat && !login) void fetchAndSetGithubIdentity(pat);
  } catch {
    // ignore
  }
}

// Hydrate at module load time, not just inside one mount effect. When Next's
// HMR re-evaluates this module the zustand store starts empty; without this
// call the page-level effect doesn't re-run and the user sees blank PAT /
// API key fields until the next save.
if (typeof window !== "undefined") loadSavedSettings();
