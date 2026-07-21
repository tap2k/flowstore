import type { ModelsFile, ModelEntry, ModelsRoles, CapabilityEndpoint, AgentEndpoint } from "@flowstore/core/schema/files/models";
import { ModelsFileSchema } from "@flowstore/core/schema/files/models";
export type { CapabilityEndpoint, ModelEntry, AgentEndpoint } from "@flowstore/core/schema/files/models";
import { validateFile, formatErrors } from "@flowstore/core/validation/ajv";
import type { FileMap, LoadError } from "./types";

const MODELS_FILE = "models/endpoints.json";

export interface ResolvedModelsConfig {
  models: Record<string, ModelEntry>;
  default: string | null;
  roles: ModelsRoles;
  capabilityEndpoints: Record<string, CapabilityEndpoint>;
  agents: Record<string, AgentEndpoint>;
}

export type ModelRole = "agent" | "judge" | "user_simulation" | "authoring";

// Endpoint id is the user-facing handle on a model entry. The dispatcher
// maps each to (provider adapter, default base_url, settings key slot).
// First-class: google, openai, openrouter. Catchall: openai-compatible
// (caller must supply base_url + a key — used for DeepInfra, vLLM, Ollama,
// Together, Fireworks, or any future provider).
//
// Anthropic native is intentionally absent: browser-direct calls fail CORS,
// so Claude routes through `openrouter` with model_id like
// "anthropic/claude-sonnet-4-5".
export type EndpointId =
  | "google"
  | "openai"
  | "openrouter"
  | "openai-compatible";

// Ships inside @flowstore/core. Used when a project has no models/ at all.
// Edit here when a new built-in model is supported. Catalog key is the
// friendly handle; model_id (when set) is the wire id sent to the API.
export const BUILT_IN_MODELS: ResolvedModelsConfig = {
  capabilityEndpoints: {},
  agents: {},
  models: {
    // Google
    "gemini-3.6-flash":         { name: "Gemini 3.6 Flash", endpoint: "google" },
    "gemini-3.5-flash":         { name: "Gemini 3.5 Flash", endpoint: "google" },
    "gemini-3.1-pro-preview":   { name: "Gemini 3.1 Pro", endpoint: "google" },
    "gemini-3.1-flash-lite":    { name: "Gemini 3.1 Flash-Lite", endpoint: "google" },
    "gemini-3-flash-preview":   { name: "Gemini 3 Flash", endpoint: "google" },
    "gemini-2.5-pro":           { name: "Gemini 2.5 Pro", endpoint: "google" },
    "gemini-2.5-flash":         { name: "Gemini 2.5 Flash", endpoint: "google" },

    // Gemini Live (bidi audio) — voice-mode only. Only Gemini exposes a
    // browser-direct Live socket, so these are the sole voice options (OpenAI
    // Realtime needs a server-minted ephemeral token). The first voice-tagged
    // entry is the default voice model; bump ids as Google rotates previews.
    // Two flavors: the half-cascade Live model and the native-audio model
    // (more natural prosody / affective dialog) — keep both to A/B.
    "gemini-3.1-flash-live-preview":   { name: "Gemini 3.1 Flash Live (voice)", endpoint: "google", voice: true },
    "gemini-2.5-flash-native-audio":   { name: "Gemini 2.5 Flash Native Audio (voice)", endpoint: "google", voice: true, model_id: "gemini-2.5-flash-native-audio-preview-09-2025" },

    // OpenAI
    "gpt-5.6-luna":             { name: "GPT-5.6 Luna", endpoint: "openai" },
    "gpt-5.6-terra":            { name: "GPT-5.6 Terra", endpoint: "openai" },
    "gpt-5.6-sol":              { name: "GPT-5.6 Sol", endpoint: "openai" },
    "gpt-5.5":                  { name: "GPT-5.5", endpoint: "openai" },
    "gpt-5.4":                  { name: "GPT-5.4", endpoint: "openai" },
    "gpt-5.4-mini":             { name: "GPT-5.4 Mini", endpoint: "openai" },
    "gpt-4o":                   { name: "GPT-4o", endpoint: "openai" },
    "gpt-4o-mini":              { name: "GPT-4o Mini", endpoint: "openai" },

    // Anthropic (via OpenRouter — Anthropic blocks browser-direct CORS)
    "claude-opus-4.8":          { name: "Claude Opus 4.8", endpoint: "openrouter", model_id: "anthropic/claude-opus-4.8" },
    "claude-sonnet-5":          { name: "Claude Sonnet 5", endpoint: "openrouter", model_id: "anthropic/claude-sonnet-5" },
    "claude-haiku-4.5":         { name: "Claude Haiku 4.5", endpoint: "openrouter", model_id: "anthropic/claude-haiku-4.5" },

    // Open-weight on OpenRouter. The :free suffix routes to the free tier.
    "grok-4.5":                 { name: "Grok 4.5", endpoint: "openrouter", model_id: "x-ai/grok-4.5" },
    "grok-4.3":                 { name: "Grok 4.3", endpoint: "openrouter", model_id: "x-ai/grok-4.3" },
    "deepseek-v4-pro":          { name: "DeepSeek V4 Pro", endpoint: "openrouter", model_id: "deepseek/deepseek-v4-pro" },
    "deepseek-v4-flash":        { name: "DeepSeek V4 Flash", endpoint: "openrouter", model_id: "deepseek/deepseek-v4-flash" },
    "kimi-k2.6":                { name: "Kimi K2.6", endpoint: "openrouter", model_id: "moonshotai/kimi-k2.6" },
    "qwen3.6-plus":             { name: "Qwen 3.6 Plus", endpoint: "openrouter", model_id: "qwen/qwen3.6-plus" },
    "qwen3.6-flash":            { name: "Qwen 3.6 Flash", endpoint: "openrouter", model_id: "qwen/qwen3.6-flash" },
    "mistral-large-2512":       { name: "Mistral Large 2512", endpoint: "openrouter", model_id: "mistralai/mistral-large-2512" },
    "gemma-4-31b":              { name: "Gemma 4 31B", endpoint: "openrouter", model_id: "google/gemma-4-31b-it" },
    "gemma-4-26b-a4b":          { name: "Gemma 4 26B A4B", endpoint: "openrouter", model_id: "google/gemma-4-26b-a4b-it" },
    "llama-4-maverick":         { name: "Llama 4 Maverick", endpoint: "openrouter", model_id: "meta-llama/llama-4-maverick" },
    "llama-4-scout":            { name: "Llama 4 Scout", endpoint: "openrouter", model_id: "meta-llama/llama-4-scout" },
    "llama-3.3-70b":            { name: "Llama 3.3 70B", endpoint: "openrouter", model_id: "meta-llama/llama-3.3-70b-instruct" },
    "gpt-oss-120b":             { name: "GPT-OSS 120B", endpoint: "openrouter", model_id: "openai/gpt-oss-120b" },
  },
  default: "gemini-2.5-flash",
  roles: {},
};


// Endpoint resolution: explicit on the entry wins (a known id dispatches to
// that adapter; an unknown explicit id falls through to the openai-compatible
// catchall). Otherwise infer from id prefix for the unambiguous cases (gemini
// → google, gpt/o-series → openai, anthropic/ prefix → openrouter). Bare
// claude-/grok-/llama- and meta-llama/ model ids stay unresolved on purpose:
// the same model lives on multiple hosts and inference can't pick the right
// one, so they need an explicit `endpoint`. Returns null when unresolvable.
const KNOWN_ENDPOINTS: ReadonlySet<EndpointId> = new Set([
  "google",
  "openai",
  "openrouter",
  "openai-compatible",
]);

export function resolveEndpoint(
  modelId: string,
  entry: ModelEntry | undefined,
): EndpointId | null {
  if (entry?.endpoint && KNOWN_ENDPOINTS.has(entry.endpoint as EndpointId)) {
    return entry.endpoint as EndpointId;
  }
  if (entry?.endpoint) {
    // Unknown explicit endpoint falls through to the catchall so future
    // values (azure, bedrock) don't silently misroute.
    return "openai-compatible";
  }
  if (/^gemini[-_.]/i.test(modelId)) return "google";
  if (/^gpt[-_]/i.test(modelId)) return "openai";
  if (/^o[1-9]/i.test(modelId)) return "openai";
  if (/^anthropic\//i.test(modelId)) return "openrouter";
  return null;
}

// Wire id used at dispatch time. Entry's `model_id` overrides the catalog
// key — entry keyed "claude-sonnet-on-openrouter" can carry the actual wire
// id "anthropic/claude-sonnet-4-5".
export function wireModelId(catalogKey: string, entry: ModelEntry | undefined): string {
  return entry?.model_id ?? catalogKey;
}

export function loadModelsConfig(
  files: FileMap,
  errors: LoadError[],
): ResolvedModelsConfig | null {
  const content = files[MODELS_FILE];
  if (!content) return null;

  let parsed: ModelsFile | null = null;
  try {
    parsed = JSON.parse(content) as ModelsFile;
  } catch (e) {
    errors.push({
      path: MODELS_FILE,
      message: e instanceof Error ? e.message : "could not parse models/endpoints.json",
    });
    return null;
  }
  const check = validateFile(ModelsFileSchema, parsed);
  if (!check.valid) {
    for (const msg of formatErrors(check.errors)) errors.push({ path: MODELS_FILE, message: msg });
    return null;
  }
  return {
    models: parsed.models ?? {},
    default: parsed.default ?? null,
    roles: parsed.roles ?? {},
    capabilityEndpoints: parsed.capabilities ?? {},
    agents: parsed.agents ?? {},
  };
}

// Drops named keys from an object — used to strip the credential-bearing
// fields below before serializing.
function omit<T extends object>(obj: T, ...keys: string[]): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of keys) delete out[k];
  return out as T;
}

// Serializes the models config back to models/endpoints.json. Every
// credential-bearing field is stripped first — project files are committed to
// GitHub and must never carry secrets (SCHEMA.md "Execution Separate From
// Spec"). Three channels carry them, one per config shape:
//   • ModelEntry.api_key          — bearer for an openai-compatible server
//   • CapabilityEndpoint.headers  — Authorization / x-api-key on a live cap
//   • AgentEndpoint.turn_headers  — Authorization / x-api-key on an external agent
// All three live only in-memory for the session (re-entered each time), the
// same as api_key always has. Returns {} when config is null or empty so the
// file is omitted from the save payload rather than written as empty.
// NOTE: because these are stripped here, editing a key or a header in the UI
// does NOT flip the dirty bit — those changes are invisible to dirty tracking.
// Intentional: secrets aren't saved to GitHub so they shouldn't gate saves.
export function decomposeModelsConfig(config: ResolvedModelsConfig | null): FileMap {
  if (!config) return {};
  const hasModels = Object.keys(config.models).length > 0;
  const hasCaps = Object.keys(config.capabilityEndpoints).length > 0;
  const hasDefault = !!config.default;
  const hasRoles = Object.keys(config.roles).length > 0;
  const hasAgents = Object.keys(config.agents).length > 0;
  if (!hasModels && !hasCaps && !hasDefault && !hasRoles && !hasAgents) return {};

  const models: Record<string, ModelEntry> = Object.fromEntries(
    Object.entries(config.models).map(([id, e]) => [id, omit(e, "api_key")]),
  );
  const capabilities: Record<string, CapabilityEndpoint> = Object.fromEntries(
    Object.entries(config.capabilityEndpoints).map(([n, e]) => [n, omit(e, "headers")]),
  );
  const agents: Record<string, AgentEndpoint> = Object.fromEntries(
    Object.entries(config.agents).map(([n, e]) => [n, omit(e, "turn_headers")]),
  );

  const file: ModelsFile = {
    $schema: "flowstore://spec/models/v0",
    ...(Object.keys(models).length ? { models } : {}),
    ...(config.default ? { default: config.default } : {}),
    ...(Object.keys(config.roles).length ? { roles: config.roles } : {}),
    ...(hasCaps ? { capabilities } : {}),
    ...(hasAgents ? { agents } : {}),
  };
  return { [MODELS_FILE]: JSON.stringify(file, null, 2) };
}

