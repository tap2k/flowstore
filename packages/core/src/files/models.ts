import type { ModelsFile, ModelEntry, ModelsRoles } from "@ux4/core/schema/files/models";
import { ModelsFileSchema } from "@ux4/core/schema/files/models";
import { validateFile, formatErrors } from "@ux4/core/validation/ajv";
import type { FileMap, LoadError } from "./types";

const MODELS_FILE_RE = /^models\/.+\.json$/;

export interface ResolvedModelsConfig {
  models: Record<string, ModelEntry>;
  default: string | null;
  roles: ModelsRoles;
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

// Ships inside @ux4/core. Used when a project has no models/ at all.
// Edit here when a new built-in model is supported. Catalog key is the
// friendly handle; model_id (when set) is the wire id sent to the API.
export const BUILT_IN_MODELS: ResolvedModelsConfig = {
  models: {
    // Google
    "gemini-3.5-flash":         { name: "Gemini 3.5 Flash", endpoint: "google" },
    "gemini-3.1-pro-preview":   { name: "Gemini 3.1 Pro (preview)", endpoint: "google" },
    "gemini-3.1-flash-lite":    { name: "Gemini 3.1 Flash-Lite", endpoint: "google" },
    "gemini-3-flash-preview":   { name: "Gemini 3 Flash (preview)", endpoint: "google" },
    "gemini-2.5-pro":           { name: "Gemini 2.5 Pro", endpoint: "google" },
    "gemini-2.5-flash":         { name: "Gemini 2.5 Flash", endpoint: "google" },

    // OpenAI
    "gpt-5.5":                  { name: "GPT-5.5", endpoint: "openai" },
    "gpt-5.4":                  { name: "GPT-5.4", endpoint: "openai" },
    "gpt-5.4-mini":             { name: "GPT-5.4 Mini", endpoint: "openai" },

    // Anthropic (via OpenRouter — Anthropic blocks browser-direct CORS)
    "claude-opus-4.7":          { name: "Claude Opus 4.7", endpoint: "openrouter", model_id: "anthropic/claude-opus-4.7" },
    "claude-sonnet-4.6":        { name: "Claude Sonnet 4.6", endpoint: "openrouter", model_id: "anthropic/claude-sonnet-4.6" },
    "claude-haiku-4.5":         { name: "Claude Haiku 4.5", endpoint: "openrouter", model_id: "anthropic/claude-haiku-4.5" },

    // Open-weight on OpenRouter. The :free suffix routes to the free tier.
    "grok-4.3":                 { name: "Grok 4.3", endpoint: "openrouter", model_id: "x-ai/grok-4.3" },
    "deepseek-v4-pro":          { name: "DeepSeek V4 Pro", endpoint: "openrouter", model_id: "deepseek/deepseek-v4-pro" },
    "deepseek-v4-flash":        { name: "DeepSeek V4 Flash", endpoint: "openrouter", model_id: "deepseek/deepseek-v4-flash" },
    "kimi-k2.6":                { name: "Kimi K2.6", endpoint: "openrouter", model_id: "moonshotai/kimi-k2.6" },
    "mistral-large-2512":       { name: "Mistral Large 2512", endpoint: "openrouter", model_id: "mistralai/mistral-large-2512" },
    "qwen3.6-plus":             { name: "Qwen 3.6 Plus", endpoint: "openrouter", model_id: "qwen/qwen3.6-plus" },
    "qwen3.6-flash":            { name: "Qwen 3.6 Flash", endpoint: "openrouter", model_id: "qwen/qwen3.6-flash" },
    "llama-4-maverick":         { name: "Llama 4 Maverick", endpoint: "openrouter", model_id: "meta-llama/llama-4-maverick" },
    "llama-4-scout":            { name: "Llama 4 Scout", endpoint: "openrouter", model_id: "meta-llama/llama-4-scout" },
    "llama-3.3-70b":            { name: "Llama 3.3 70B", endpoint: "openrouter", model_id: "meta-llama/llama-3.3-70b-instruct" },
  },
  default: "gemini-2.5-flash",
  roles: {},
};

// Endpoint resolution: explicit on the entry wins; otherwise infer from id
// prefix for the unambiguous cases (gemini → google, gpt/o-series →
// openai, anthropic/ prefix → openrouter, meta-llama/ prefix → deepinfra).
// Bare claude-/grok-/llama- model ids stay unresolved on purpose; the same
// model lives on multiple hosts and inference can't pick the right one.
// Returns null when the entry needs explicit `endpoint` to dispatch.
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
  const paths = Object.keys(files).filter((p) => MODELS_FILE_RE.test(p)).sort();
  if (paths.length === 0) return null;

  const merged: ResolvedModelsConfig = { models: {}, default: null, roles: {} };
  for (const path of paths) {
    let parsed: ModelsFile | null = null;
    try {
      parsed = JSON.parse(files[path]) as ModelsFile;
    } catch (e) {
      errors.push({
        path,
        message: e instanceof Error ? e.message : "could not parse models file",
      });
      continue;
    }
    const check = validateFile(ModelsFileSchema, parsed);
    if (!check.valid) {
      for (const msg of formatErrors(check.errors)) errors.push({ path, message: msg });
      continue;
    }
    if (parsed.models) {
      for (const [id, entry] of Object.entries(parsed.models)) {
        merged.models[id] = entry;
      }
    }
    if (parsed.default) merged.default = parsed.default;
    if (parsed.roles) {
      merged.roles = { ...merged.roles, ...parsed.roles };
    }
  }
  return merged;
}

export interface ResolveOptions {
  role?: ModelRole;
  // agent.default_model — sits between project role and explicit override per
  // FILE-MODEL.md § Model selection resolution order.
  agentDefault?: string;
  // Explicit override (env var / CLI flag / per-file `model` field on a test
  // case, rubric, or persona). Highest precedence.
  override?: string;
}

// Walks the precedence chain low-to-high: built-in default -> project default
// -> project role -> agent.default_model -> override. Returns null if nothing
// resolves.
export function resolveModel(
  project: ResolvedModelsConfig | null,
  opts: ResolveOptions = {},
): string | null {
  if (opts.override) return opts.override;
  if (opts.agentDefault) return opts.agentDefault;
  if (opts.role && project?.roles?.[opts.role]) return project.roles[opts.role] ?? null;
  if (project?.default) return project.default;
  if (opts.role && BUILT_IN_MODELS.roles?.[opts.role]) return BUILT_IN_MODELS.roles[opts.role] ?? null;
  if (BUILT_IN_MODELS.default) return BUILT_IN_MODELS.default;
  return null;
}
