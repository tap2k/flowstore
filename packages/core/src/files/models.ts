import type { ModelsFile, ModelEntry, ModelsRoles } from "@ux4/core/schema/files/models";
import type { FileMap, LoadError } from "./types";

const MODELS_FILE_RE = /^models\/.+\.json$/;

export interface ResolvedModelsConfig {
  models: Record<string, ModelEntry>;
  default: string | null;
  roles: ModelsRoles;
}

export type ModelRole = "agent" | "judge" | "user_simulation" | "authoring";

// Ships inside @ux4/core. Used when a project has no models/ at all (or
// when the project's config doesn't set a field the consumer is asking
// about). Edit here when a new Google model is supported.
export const BUILT_IN_MODELS: ResolvedModelsConfig = {
  models: {
    "gemini-3.1-pro-preview": { name: "Gemini 3.1 Pro (preview)" },
    "gemini-3-flash-preview": { name: "Gemini 3 Flash (preview)" },
    "gemini-2.5-pro": { name: "Gemini 2.5 Pro" },
    "gemini-2.5-flash": { name: "Gemini 2.5 Flash" },
  },
  default: "gemini-2.5-flash",
  roles: {},
};

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
