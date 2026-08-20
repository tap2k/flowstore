import type { Spec, Agent, Flow } from "@flowstore/core/schema/v0";
import { validateSpec, validateFile, formatErrors } from "@flowstore/core/validation/ajv";
import { ProjectManifestSchema } from "@flowstore/core/schema/files/project";
import { ProjectGlossaryFileSchema } from "@flowstore/core/schema/files/glossary";
import { FaqFileSchema } from "@flowstore/core/schema/files/faq";
import { GuardrailsFileSchema } from "@flowstore/core/schema/files/guardrails";
import { BusinessGoalsFileSchema } from "@flowstore/core/schema/files/businessGoals";
import { VariablesFileSchema } from "@flowstore/core/schema/files/variables";
import { CapabilityFileSchema } from "@flowstore/core/schema/files/capability";
import { KnowledgeTableMetaSchema } from "@flowstore/core/schema/files/knowledgeTable";
import { mergeScriptsCsv } from "@flowstore/core/codegen/scriptsCsv";
import { parseTableRowsCsv } from "@flowstore/core/codegen/knowledgeCsv";
import { loadModelsConfig } from "./models";
import { loadTestingArtifacts } from "./testing";
import { loadComments } from "./comments";
import type { FileMap, LoadError, LoadResult } from "./types";

const FLOW_FILE_RE = /^flows\/(.+)\.flow\.json$/;
const FLOW_SCRIPTS_RE = /^flows\/(.+)\.scripts\.csv$/;
const TABLE_META_RE = /^knowledge\/tables\/(.+)\.meta\.json$/;

// Project-scope collections decomposed out of agent.json. Each accepts file
// form (the named file) or directory form (a dir of same-shaped files), per
// FILE-MODEL § "The shape rule". Capabilities are directory-only — one
// declaration per `<id>.capability.json`.
const GUARDRAILS_DIR_RE = /^guardrails\/(.+)\.json$/;
const BUSINESS_GOALS_DIR_RE = /^business-goals\/(.+)\.json$/;
const VARIABLES_DIR_RE = /^variables\/(.+)\.json$/;
const FAQ_DIR_RE = /^knowledge\/faq\/(.+)\.json$/;
const CAPABILITY_DECL_RE = /^capabilities\/(.+)\.capability\.json$/;

type Capability = NonNullable<Agent["capabilities"]>[number];
type Guardrail = NonNullable<Agent["guardrails"]>[number];
type BusinessGoal = NonNullable<Agent["business_goals"]>[number];
type FaqEntry = NonNullable<NonNullable<Agent["knowledge"]>["faq"]>[number];
type VariableDecl = NonNullable<Agent["variables"]>[string];

// A serialized FileMap bundle (.flowstore.json): a plain object mapping paths
// to file contents, with agent.json at the root. Distinguishable from a bare
// spec (whose values are objects, not strings). The bundle is interchange
// only — recognized here, expanded through loadProject, never a second
// canonical form.
export function isFileMapBundle(data: unknown): data is FileMap {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  return "agent.json" in obj && Object.values(obj).every((v) => typeof v === "string");
}

export function loadProject(files: FileMap): LoadResult {
  const errors: LoadError[] = [];

  // Optional project manifest: validate shape if present.
  const manifestRaw = files["flowstore.json"];
  if (manifestRaw !== undefined) {
    const manifest = parseJson<unknown>(manifestRaw, "flowstore.json", errors);
    if (manifest !== null) validateFileInto(manifest, ProjectManifestSchema, "flowstore.json", errors);
  }

  const modelsConfig = loadModelsConfig(files, errors);
  const testingArtifacts = loadTestingArtifacts(files, errors);
  const comments = loadComments(files, errors);

  const agentRaw = files["agent.json"];
  if (agentRaw === undefined) {
    return {
      spec: null,
      modelsConfig,
      testingArtifacts,
      comments,
      errors: [{ message: "missing agent.json at project root" }],
    };
  }

  const agent = parseJson<Agent>(agentRaw, "agent.json", errors);
  if (!agent) return { spec: null, modelsConfig, testingArtifacts, comments, errors };

  // --- Project-scope collections decomposed out of agent.json ---
  // Each merges into the agent envelope; an id (or variable key) appearing
  // both inline in agent.json and in a file is a collision error.
  const fileGuardrails = loadArrayCollection<Guardrail>(
    files, errors, "guardrails.json", GUARDRAILS_DIR_RE, GuardrailsFileSchema, "guardrails",
  );
  agent.guardrails = mergeById(agent.guardrails, fileGuardrails, "guardrail", errors);

  const fileGoals = loadArrayCollection<BusinessGoal>(
    files, errors, "business-goals.json", BUSINESS_GOALS_DIR_RE, BusinessGoalsFileSchema, "business_goals",
  );
  agent.business_goals = mergeById(agent.business_goals, fileGoals, "business goal", errors);

  const fileCapabilities = loadCapabilityDecls(files, errors);
  agent.capabilities = mergeById(agent.capabilities, fileCapabilities, "capability", errors);

  const fileVariables = loadVariablesCollection(files, errors);
  agent.variables = mergeVariables(agent.variables, fileVariables, errors);

  const fileFaq = loadArrayCollection<FaqEntry>(
    files, errors, "knowledge/faq.json", FAQ_DIR_RE, FaqFileSchema, "faq",
  );
  const mergedFaq = mergeById(agent.knowledge?.faq, fileFaq, "FAQ", errors);
  if (mergedFaq && mergedFaq.length > 0) {
    agent.knowledge = { ...(agent.knowledge ?? {}), faq: mergedFaq } as Agent["knowledge"];
  }

  // Project-scope: knowledge/glossary.json (file form). Directory form
  // (knowledge/glossary/<sub>.json) ships when a real spec uses it.
  const glossaryRaw = files["knowledge/glossary.json"];
  if (glossaryRaw !== undefined) {
    const glossaryFile = parseJson<{ glossary?: unknown[] }>(
      glossaryRaw,
      "knowledge/glossary.json",
      errors,
    );
    if (glossaryFile !== null) {
      validateFileInto(glossaryFile, ProjectGlossaryFileSchema, "knowledge/glossary.json", errors);
    }
    if (glossaryFile && Array.isArray(glossaryFile.glossary)) {
      const nextKnowledge = { ...(agent.knowledge ?? {}), glossary: glossaryFile.glossary };
      agent.knowledge = nextKnowledge as Agent["knowledge"];
    }
  }

  const tablePaths = Object.keys(files).filter((p) => TABLE_META_RE.test(p)).sort();
  if (tablePaths.length > 0) {
    const tables: unknown[] = [];
    for (const path of tablePaths) {
      const match = TABLE_META_RE.exec(path)!;
      const baseId = match[1];
      const meta = parseJson<{ structure?: unknown[] } & Record<string, unknown>>(
        files[path],
        path,
        errors,
      );
      if (!meta) continue;
      validateFileInto(meta, KnowledgeTableMetaSchema, path, errors);
      const csvPath = `knowledge/tables/${baseId}.csv`;
      const csv = files[csvPath];
      if (csv === undefined) {
        errors.push({ path, message: `table meta has no paired CSV at ${csvPath}` });
        continue;
      }
      const { $schema: _schema, ...metaFields } = meta;
      const rows = parseTableRowsCsv(csv, metaFields as Parameters<typeof parseTableRowsCsv>[1]);
      tables.push({ ...metaFields, rows });
    }
    const nextKnowledge = { ...(agent.knowledge ?? {}), tables };
    agent.knowledge = nextKnowledge as Agent["knowledge"];
  }

  const flows: Flow[] = [];
  const languages = agent.meta?.languages ?? [];
  const flowPaths = Object.keys(files)
    .filter((p) => FLOW_FILE_RE.test(p))
    .sort();
  for (const path of flowPaths) {
    const match = FLOW_FILE_RE.exec(path);
    if (!match) continue;
    const baseId = match[1];
    const flow = parseJson<Flow>(files[path], path, errors);
    if (!flow) continue;

    const scriptsPath = `flows/${baseId}.scripts.csv`;
    const csv = files[scriptsPath];
    if (csv !== undefined) {
      // Pass the flow file's scripts as the merge base so per-script
      // variations (kept in .flow.json) survive into the resolved spec.
      flow.scripts = mergeScriptsCsv(csv, flow.scripts, languages);
    }
    flows.push(flow);
  }

  // Surface stray scripts.csv files that don't pair with a .flow.json.
  for (const path of Object.keys(files)) {
    const match = FLOW_SCRIPTS_RE.exec(path);
    if (!match) continue;
    const flowPath = `flows/${match[1]}.flow.json`;
    if (!(flowPath in files)) {
      errors.push({ path, message: `scripts CSV with no matching flow file: ${flowPath}` });
    }
  }

  const candidate = { agent, flows } as Spec;
  const result = validateSpec(candidate);
  if (!result.valid) {
    for (const e of result.errors) {
      errors.push({ message: `${e.instancePath || "(root)"} ${e.message ?? ""}`.trim() });
    }
    return { spec: null, modelsConfig, testingArtifacts, comments, errors };
  }

  return { spec: result.spec, modelsConfig, testingArtifacts, comments, errors };
}

// Read an array-shaped project-scope collection that may live in file form
// (`fileName`) and/or directory form (`dirRe`). Both forms use the same
// wrapper schema with entries under `key`; entries are concatenated in
// path-sorted order. Returns [] when neither form is present.
function loadArrayCollection<E>(
  files: FileMap,
  errors: LoadError[],
  fileName: string,
  dirRe: RegExp,
  schema: Parameters<typeof validateFile>[0],
  key: string,
): E[] {
  const paths = Object.keys(files).filter((p) => p === fileName || dirRe.test(p)).sort();
  const out: E[] = [];
  for (const path of paths) {
    const parsed = parseJson<Record<string, unknown>>(files[path], path, errors);
    if (!parsed) continue;
    validateFileInto(parsed, schema, path, errors);
    const entries = parsed[key];
    if (Array.isArray(entries)) out.push(...(entries as E[]));
  }
  return out;
}

// Variables decompose to a dict, not an array; merge file/dir forms and flag
// a key defined in more than one file.
function loadVariablesCollection(files: FileMap, errors: LoadError[]): Record<string, VariableDecl> {
  const paths = Object.keys(files)
    .filter((p) => p === "variables.json" || VARIABLES_DIR_RE.test(p))
    .sort();
  const out: Record<string, VariableDecl> = {};
  for (const path of paths) {
    const parsed = parseJson<{ variables?: Record<string, VariableDecl> }>(files[path], path, errors);
    if (!parsed) continue;
    validateFileInto(parsed, VariablesFileSchema, path, errors);
    for (const [name, decl] of Object.entries(parsed.variables ?? {})) {
      if (name in out) {
        errors.push({ path, message: `duplicate variable declaration "${name}" across variables files` });
        continue;
      }
      out[name] = decl;
    }
  }
  return out;
}

// Capability declarations are directory-only: one capability object (plus a
// $schema discriminator) per `capabilities/<id>.capability.json`.
function loadCapabilityDecls(files: FileMap, errors: LoadError[]): Capability[] {
  const paths = Object.keys(files).filter((p) => CAPABILITY_DECL_RE.test(p)).sort();
  const out: Capability[] = [];
  for (const path of paths) {
    const parsed = parseJson<Record<string, unknown>>(files[path], path, errors);
    if (!parsed) continue;
    validateFileInto(parsed, CapabilityFileSchema, path, errors);
    const baseId = CAPABILITY_DECL_RE.exec(path)![1];
    if (parsed.id !== baseId) {
      errors.push({ path, message: `capability id "${String(parsed.id)}" does not match filename "${baseId}.capability.json"` });
    }
    const { $schema: _schema, ...decl } = parsed;
    out.push(decl as Capability);
  }
  return out;
}

// Union inline (agent-scope) entries with file-based (project-scope) entries.
// A duplicate id — inline-vs-file, across files, or within one file — is a
// collision error (FILE-MODEL § Collision handling: explicit over implicit).
function mergeById<E extends { id: string }>(
  inline: E[] | undefined,
  fromFiles: E[],
  label: string,
  errors: LoadError[],
): E[] | undefined {
  if (fromFiles.length === 0) return inline;
  const merged = [...(inline ?? [])];
  const seen = new Set(merged.map((e) => e.id));
  for (const e of fromFiles) {
    if (seen.has(e.id)) {
      errors.push({ message: `duplicate ${label} id "${e.id}" — defined more than once across agent.json and decomposed files` });
      continue;
    }
    seen.add(e.id);
    merged.push(e);
  }
  return merged;
}

function mergeVariables(
  inline: Record<string, VariableDecl> | undefined,
  fromFiles: Record<string, VariableDecl>,
  errors: LoadError[],
): Record<string, VariableDecl> | undefined {
  if (Object.keys(fromFiles).length === 0) return inline;
  const merged: Record<string, VariableDecl> = { ...(inline ?? {}) };
  for (const [name, decl] of Object.entries(fromFiles)) {
    if (inline && name in inline) {
      errors.push({ message: `duplicate variable declaration "${name}" — defined both inline in agent.json and in a variables file` });
      continue;
    }
    merged[name] = decl;
  }
  return merged;
}

function parseJson<T>(text: string, path: string, errors: LoadError[]): T | null {
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    errors.push({ path, message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

function validateFileInto(
  input: unknown,
  schema: Parameters<typeof validateFile>[0],
  path: string,
  errors: LoadError[],
): void {
  const result = validateFile(schema, input);
  if (result.valid) return;
  for (const msg of formatErrors(result.errors)) {
    errors.push({ path, message: msg });
  }
}
