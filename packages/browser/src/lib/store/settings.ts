import { create } from "zustand";
import { BUILT_IN_MODELS, resolveEndpoint, wireModelId } from "@flowstore/core/files/models";
import type { EndpointId } from "@flowstore/core/files/models";
import type { ProviderId } from "@flowstore/core/llm/types";
import { useModelsStore } from "./models";

const KEY = "flowstore:settings:google_api_key";
const OPENAI_KEY = "flowstore:settings:openai_api_key";
const OPENROUTER_KEY = "flowstore:settings:openrouter_api_key";
const DEFAULT_MODEL_KEY = "flowstore:settings:default_model";
const RUNNER_KEY = "flowstore:settings:runner_url";
const GITHUB_PAT_KEY = "flowstore:settings:github_pat";
const SIM_ATTRIBUTION_KEY = "flowstore:settings:simulate_attribution";
const GITHUB_LOGIN_KEY = "flowstore:settings:github_login";
const GITHUB_NAME_KEY = "flowstore:settings:github_name";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

// Used as the input placeholder in the Settings sheet — the actual stored
// value starts empty so an empty field communicates "configure to enable
// runner mode" rather than "this is set, ready to go."
export const DEFAULT_RUNNER_URL = "http://localhost:8000";
export const DEFAULT_MODEL_ID = BUILT_IN_MODELS.default ?? "gemini-2.5-flash";

// The voice (Live) model is provider-locked to Gemini Live, so unlike the
// other per-location picks it is NOT seeded from defaultModel — it defaults
// to the first voice-tagged catalog entry.
export const DEFAULT_VOICE_MODEL_ID =
  Object.entries(BUILT_IN_MODELS.models).find(([, e]) => e.voice)?.[0] ??
  "gemini-3.1-flash-live-preview";

interface SettingsState {
  googleApiKey: string;
  openaiApiKey: string;
  openrouterApiKey: string;
  // defaultModel is the ONE persisted model choice: the value used wherever
  // no explicit per-location pick is made (Generate vars/mocks/persona-from-
  // name+notes; Translate; the flow watcher). Any dispatchable model works —
  // structured output uses the provider's strict-schema mode where it exists
  // and validated chat elsewhere (see core structuredOutput).
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
  // The agent model for voice (Live) sessions. Provider-locked to Gemini
  // Live; kept separate from simulateAgentModel (which can be any provider)
  // because a voice session can only dispatch to a Live-capable model.
  simulateVoiceModel: string;
  runnerUrl: string;
  // Live canvas attribution during prompt-mode simulation (the flow watcher —
  // one extra structured LLM call per agent turn on the default model). ON by
  // default: the lit canvas is the point of simulating next to the graph. Turn
  // off to save rate-limit headroom during persona batch runs (agent + persona
  // + watcher = 3 calls/turn), to trim cost on expensive default models, or to
  // stop the glow. Persisted.
  simulateAttribution: boolean;
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
  setSimulateVoiceModel: (model: string) => void;
  setGenerateModel: (model: string) => void;
  setRunnerUrl: (url: string) => void;
  setSimulateAttribution: (on: boolean) => void;
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
  simulateVoiceModel: DEFAULT_VOICE_MODEL_ID,
  defaultModel: DEFAULT_MODEL_ID,
  runnerUrl: "",
  simulateAttribution: true,
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
  setSimulateVoiceModel: (model) => set({ simulateVoiceModel: model }),
  setGenerateModel: (model) => {
    persistString(DEFAULT_MODEL_KEY, model);
    set({ defaultModel: model });
  },
  setRunnerUrl: (url) => {
    const trimmed = url.trim().replace(/\/+$/, "");
    persistString(RUNNER_KEY, trimmed);
    set({ runnerUrl: trimmed });
  },
  // Stored only when OFF ("0") — absence means the default (on).
  setSimulateAttribution: (on) => {
    persistString(SIM_ATTRIBUTION_KEY, on ? "" : "0");
    set({ simulateAttribution: on });
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

// Draft keys, keyed by endpoint, that take precedence over the persisted
// store when resolving an API key. The Settings sheet passes its in-progress
// (unsaved) key fields so the picker reflects a just-typed key instead of
// showing "(no key)" until Save.
export type KeyOverrides = Partial<Record<EndpointId, string>>;

// Look up the dispatch parameters for a given model id. Checks BUILT_IN_MODELS
// first; falls back to the project-level models config (models/*.json) for
// IDs not in the built-in catalog. Returns the provider, the API key from
// settings (or the entry's api_key for project models), and (for
// openai-compatible hosts) the base URL.
// Reads settings imperatively — call from event handlers, not during render.
// Pass `keyOverrides` to resolve against unsaved draft keys instead.
export function resolveDispatch(modelId: string, keyOverrides?: KeyOverrides): ResolvedDispatch {
  const s = useSettingsStore.getState();
  const builtinEntry = BUILT_IN_MODELS.models[modelId];
  const projectEntry = useModelsStore.getState().config?.models[modelId];
  // Project entry wins — allows endpoints.json to override a built-in (e.g.
  // point gemini-2.5-flash at a staging base_url).
  const entry = projectEntry ?? builtinEntry;
  const endpoint = resolveEndpoint(modelId, entry);
  const wireModel = wireModelId(modelId, entry);
  // A draft value (including "") for the resolved endpoint wins over the store.
  const keyFor = (e: EndpointId, stored: string) =>
    keyOverrides && keyOverrides[e] !== undefined ? keyOverrides[e]! : stored;
  // OpenRouter fallback for native-endpoint models: a FALLBACK, never an
  // override — with the native key present the picked route always wins.
  // Only when the native key is absent and an OpenRouter key exists does the
  // model dispatch there, under OpenRouter's vendor-prefixed id. Keeps "one
  // OpenRouter key covers the whole matrix" true (and those calls return
  // measured $). Voice (Live) entries are excluded — they are Google-only,
  // and a fallback would swap the crisp "needs a Google key" error for a
  // confusing OpenRouter 404. Structured-output callers are unaffected:
  // provider resolves to openai-compatible, which their gate already rejects.
  const openrouterFallback = (vendor: string): ResolvedDispatch | null => {
    const orKey = keyFor("openrouter", s.openrouterApiKey);
    if (!orKey.trim() || (entry as { voice?: boolean } | undefined)?.voice) return null;
    return {
      provider: "openai-compatible",
      apiKey: orKey,
      baseUrl: OPENROUTER_BASE_URL,
      endpoint: "openrouter",
      wireModel: `${vendor}/${wireModel}`,
    };
  };
  switch (endpoint) {
    case "google": {
      const apiKey = keyFor("google", s.googleApiKey);
      if (!apiKey.trim()) {
        const fb = openrouterFallback("google");
        if (fb) return fb;
      }
      return { provider: "google", apiKey, endpoint, wireModel };
    }
    case "openai": {
      const apiKey = keyFor("openai", s.openaiApiKey);
      if (!apiKey.trim()) {
        const fb = openrouterFallback("openai");
        if (fb) return fb;
      }
      return { provider: "openai", apiKey, endpoint, wireModel };
    }
    case "openrouter":
      return {
        provider: "openai-compatible",
        apiKey: keyFor("openrouter", s.openrouterApiKey),
        baseUrl: OPENROUTER_BASE_URL,
        endpoint,
        wireModel,
      };
    case "openai-compatible": {
      // base_url and api_key come from the project entry. A project model
      // with a base_url is always dispatchable — no global settings slot.
      const baseUrl = (entry as { base_url?: string } | undefined)?.base_url;
      const entryKey = (entry as { api_key?: string } | undefined)?.api_key ?? "";
      return { provider: "openai-compatible", apiKey: entryKey, baseUrl, endpoint, wireModel };
    }
    default:
      return { provider: null, apiKey: "", endpoint: null, wireModel };
  }
}

// True iff the model can be dispatched (has an API key or is a project model
// with a base_url, which doesn't need a global key slot). Used by the model
// picker to filter out models the user can't dispatch. Pass `keyOverrides`
// to test against unsaved draft keys.
export function hasKeyForModel(modelId: string, keyOverrides?: KeyOverrides): boolean {
  const r = resolveDispatch(modelId, keyOverrides);
  if (r.apiKey.trim()) return true;
  // Project openai-compatible models with a base_url are self-sufficient.
  if (r.provider === "openai-compatible" && r.baseUrl) return true;
  return false;
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
    if (window.localStorage.getItem(SIM_ATTRIBUTION_KEY) === "0") {
      patch.simulateAttribution = false;
    }
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
