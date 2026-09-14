import type { Spec, Agent, Flow, FlowStep } from "@flowstore/core/schema/v0";
import { validateSpec, validateFile, formatErrors } from "@flowstore/core/validation/ajv";
import { ProjectManifestSchema } from "@flowstore/core/schema/files/project";
import { coerceCell } from "@flowstore/core/codegen/knowledgeCsv";
import { loadModelsConfig } from "./models";
import { loadTestingArtifacts } from "./testing";
import { loadComments } from "./comments";
import { legacySpecPaths } from "./legacy";
import { legacyTestingPaths } from "./testing";
import { legacyModelsPaths } from "./models";
import type { FileMap, LoadError, LoadResult } from "./types";
import {
  findSection,
  fromYaml,
  parseItems,
  parseLocalized,
  parseTable,
  splitEntries,
  splitFrontmatter,
  splitSections,
  AGENT_META_KEYS,
} from "./markdown";

// Source files → spec. The inverse of decomposeSpec (decompose.ts). Every
// collection accepts file form or directory form (FILE-MODEL § the shape
// rule); ids come from filenames for per-file entities and from explicit
// `### id` / `- id:` markers inside a body. A project that still carries the
// pre-markdown JSON layout does not load: the error names flowstore-migrate,
// which is the only reader of that layout.

const FLOW_RE = /^flows\/(.+)\.md$/;
const CAPABILITY_RE = /^capabilities\/(.+)\.md$/;
const TABLE_RE = /^knowledge\/tables\/(.+)\.md$/;
const GUARDRAILS_DIR_RE = /^guardrails\/(.+)\.md$/;
const FAQ_DIR_RE = /^knowledge\/faq\/(.+)\.md$/;
const VARIABLES_DIR_RE = /^variables\/(.+)\.ya?ml$/;
const GOALS_DIR_RE = /^business-goals\/(.+)\.ya?ml$/;

type Capability = NonNullable<Agent["capabilities"]>[number];
type Guardrail = NonNullable<Agent["guardrails"]>[number];
type BusinessGoal = NonNullable<Agent["business_goals"]>[number];
type FaqEntry = NonNullable<NonNullable<Agent["knowledge"]>["faq"]>[number];
type GlossaryEntry = NonNullable<NonNullable<Agent["knowledge"]>["glossary"]>[number];
type TableEntry = NonNullable<NonNullable<Agent["knowledge"]>["tables"]>[number];
type VariableDecl = NonNullable<Agent["variables"]>[string];
type ExitPath = Flow["exit_paths"][number];
type ScriptLine = NonNullable<Flow["scripts"]>[number];

export const AGENT_FILE = "agent.md";

// A serialized FileMap bundle (.flowstore.json): a plain object mapping paths
// to file contents. Interchange only — expanded through loadProject, never a
// second canonical form.
export function isFileMapBundle(data: unknown): data is FileMap {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  return AGENT_FILE in obj && Object.values(obj).every((v) => typeof v === "string");
}

export function isLegacyLayout(files: FileMap): boolean {
  return files[AGENT_FILE] === undefined && files["agent.json"] !== undefined;
}

export const MIGRATE_HINT = "this project is in the pre-markdown JSON layout; run `flowstore-migrate <project-dir>` to convert it";

export function loadProject(files: FileMap): LoadResult {
  const errors: LoadError[] = [];
  const empty = { spec: null, modelsConfig: null, comments: [], testingArtifacts: { testCases: [], personas: [], rubrics: [], golds: [], decisions: [], ignored: [] } };
  if (isLegacyLayout(files)) return { ...empty, errors: [{ message: MIGRATE_HINT }] };
  // A markdown project must not carry old files beside the new ones: the
  // loader would silently ignore them, and whatever they hold would be lost.
  const stale = [...legacySpecPaths(files), ...legacyTestingPaths(files), ...legacyModelsPaths(files)];
  for (const path of stale) errors.push({ path, message: `pre-markdown file beside the markdown layout; ${MIGRATE_HINT}` });
  if (stale.length > 0 && files[AGENT_FILE] !== undefined) return { ...empty, errors };

  if (files["flowstore.yaml"] !== undefined) {
    const manifest = attempt(errors, "flowstore.yaml", () => fromYaml<unknown>(files["flowstore.yaml"], "flowstore.yaml"));
    if (manifest !== null) {
      const check = validateFile(ProjectManifestSchema, manifest);
      if (!check.valid) for (const m of formatErrors(check.errors)) errors.push({ path: "flowstore.yaml", message: m });
    }
  }
  const modelsConfig = loadModelsConfig(files, errors);
  const testingArtifacts = loadTestingArtifacts(files, errors);
  const comments = loadComments(files, errors);

  if (files[AGENT_FILE] === undefined) {
    return {
      spec: null,
      modelsConfig,
      testingArtifacts,
      comments,
      errors: [{ message: `missing ${AGENT_FILE} at project root` }],
    };
  }

  const agent = attempt(errors, AGENT_FILE, () => parseAgent(files[AGENT_FILE]));
  if (!agent) return { spec: null, modelsConfig, testingArtifacts, comments, errors };
  const languages = agent.meta?.languages ?? [];

  const guardrails = collect<Guardrail>(files, errors, "guardrails.md", GUARDRAILS_DIR_RE, (text, path) =>
    parseGuardrails(text, path),
  );
  if (guardrails.length > 0) agent.guardrails = uniqueById(guardrails, "guardrail", errors);

  const goals = collect<BusinessGoal>(files, errors, "business-goals.yaml", GOALS_DIR_RE, (text, path) =>
    asArray<BusinessGoal>(fromYaml(text, path), path),
  );
  if (goals.length > 0) agent.business_goals = uniqueById(goals, "business goal", errors);

  const variables: Record<string, VariableDecl> = {};
  for (const path of collectionPaths(files, "variables.yaml", VARIABLES_DIR_RE)) {
    const parsed = attempt(errors, path, () => fromYaml<Record<string, VariableDecl> | null>(files[path], path));
    for (const [name, decl] of Object.entries(parsed ?? {})) {
      if (name in variables) {
        errors.push({ path, message: `duplicate variable declaration "${name}" across variables files` });
        continue;
      }
      variables[name] = decl;
    }
  }
  if (Object.keys(variables).length > 0) agent.variables = variables;

  const capabilities: Capability[] = [];
  for (const path of Object.keys(files).filter((p) => CAPABILITY_RE.test(p)).sort()) {
    const id = CAPABILITY_RE.exec(path)![1];
    const doc = attempt(errors, path, () => splitFrontmatter(files[path], path));
    if (!doc) continue;
    capabilities.push({ id, ...doc.meta, description: doc.body.trim() } as Capability);
  }
  if (capabilities.length > 0) agent.capabilities = uniqueById(capabilities, "capability", errors);

  const knowledge: NonNullable<Agent["knowledge"]> = {};
  const faq = collect<FaqEntry>(files, errors, "knowledge/faq.md", FAQ_DIR_RE, (text, path) =>
    parseFaq(text, path, languages),
  );
  if (faq.length > 0) knowledge.faq = uniqueById(faq, "FAQ", errors);

  if (files["knowledge/glossary.md"] !== undefined) {
    const entries = attempt(errors, "knowledge/glossary.md", () => parseGlossary(files["knowledge/glossary.md"]));
    if (entries && entries.length > 0) knowledge.glossary = uniqueById(entries, "glossary", errors);
  }

  const tablePaths = Object.keys(files).filter((p) => TABLE_RE.test(p)).sort();
  if (tablePaths.length > 0) {
    const tables: TableEntry[] = [];
    for (const path of tablePaths) {
      const id = TABLE_RE.exec(path)![1];
      const t = attempt(errors, path, () => parseKnowledgeTable(id, files[path], path));
      if (t) tables.push(t);
    }
    knowledge.tables = tables;
  }
  if (Object.keys(knowledge).length > 0) agent.knowledge = knowledge;

  const flows: Flow[] = [];
  for (const path of Object.keys(files).filter((p) => FLOW_RE.test(p)).sort()) {
    const id = FLOW_RE.exec(path)![1];
    const flow = attempt(errors, path, () => parseFlow(id, files[path], path, languages));
    if (flow) flows.push(flow);
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

// ---------- agent.md ----------

export function parseAgent(text: string): Agent {
  const doc = splitFrontmatter(text, AGENT_FILE);
  const meta: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.meta)) (AGENT_META_KEYS.has(k) ? meta : rest)[k] = v;
  const agent: Record<string, unknown> = { $schema: "flowstore://spec/agent/v0", ...rest, meta: dropUndefined(meta) };
  const body = doc.body.trim();
  if (body) agent.system_prompt = body;
  return dropUndefined(agent) as unknown as Agent;
}

// ---------- guardrails.md ----------

function parseGuardrails(text: string, path: string): Guardrail[] {
  const { items, rest } = parseItems(stripHeadings(text));
  if (rest.trim() !== "") {
    throw new Error(`${path}: expected only "- id: statement" lines; found: ${rest.trim().split("\n")[0]}`);
  }
  return items.map((it) => ({ id: it.key, statement: it.text }));
}

// ---------- knowledge/faq.md ----------

function parseFaq(text: string, path: string, languages: string[]): FaqEntry[] {
  const { lead, entries } = splitEntries(stripHeadings(text));
  if (lead.trim() !== "") throw new Error(`${path}: text before the first "### id: question" heading`);
  return entries.map((e) => ({ id: e.id, question: e.title, answer: parseLocalized(e.body, languages) }));
}

function parseGlossary(text: string): GlossaryEntry[] {
  const { entries } = splitEntries(stripHeadings(text));
  return entries.map((e) => ({ id: e.id, term: e.title, definition: e.body.trim() }));
}

function parseKnowledgeTable(id: string, text: string, path: string): TableEntry {
  const doc = splitFrontmatter(text, path);
  const structure = (doc.meta.structure ?? []) as TableEntry["structure"];
  const { header, rows } = parseTable(doc.body);
  const typeByField = new Map(structure.map((f) => [f.field, f.type ?? "string"]));
  return {
    id,
    ...doc.meta,
    structure,
    rows: rows.map((r) => Object.fromEntries(header.map((f, i) => [f, coerceCell(r[i] ?? "", typeByField.get(f) ?? "string")]))),
  } as TableEntry;
}

// ---------- flows/<id>.md ----------

export function parseFlow(id: string, text: string, path: string, languages: string[]): Flow {
  const doc = splitFrontmatter(text, path);
  const { preamble, sections } = splitSections(doc.body);

  const lines = preamble.split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^# /.test(l));
  if (h1 === -1) throw new Error(`${path}: missing "# <flow name>" heading`);
  const name = lines[h1].replace(/^# /, "").trim();
  const instructions = lines.slice(h1 + 1).join("\n").trim();

  const flow: Record<string, unknown> = {
    $schema: "flowstore://spec/flow/v0",
    id,
    name,
    ...frontmatterToFlowFields(doc.meta),
  };
  if (instructions) flow.instructions = instructions;

  const steps = findSection(sections, "Steps");
  if (steps) flow.steps = parseSteps(steps.body, path);

  const scripts = findSection(sections, "Scripts");
  if (scripts) flow.scripts = parseScripts(scripts.body, languages, path);

  const guardrails = findSection(sections, "Guardrails");
  if (guardrails) flow.guardrails = parseGuardrails(guardrails.body, path);

  const faq = findSection(sections, "FAQ");
  if (faq) flow.knowledge = { faq: parseFaq(faq.body, path, languages) };

  const example = findSection(sections, "Example");
  if (example) flow.example = example.body.trim();

  const notes = findSection(sections, "Notes");
  if (notes) flow.notes = notes.body.trim();

  const known = new Set(["steps", "scripts", "guardrails", "faq", "example", "notes"]);
  for (const s of sections) {
    if (!known.has(s.title.toLowerCase())) throw new Error(`${path}: unknown section "## ${s.title}"`);
  }
  return flow as unknown as Flow;
}

// `## Steps`: one `### step_id: name` entry per agent turn, in order. The
// entry body is the step's instructions; a `- scripts: s_a, s_b` line names
// the flow-level scripts this turn uses.
function parseSteps(body: string, path: string): FlowStep[] {
  const { lead, entries } = splitEntries(body);
  if (lead.trim() !== "") throw new Error(`${path}: text before the first "### step_id: name" heading under ## Steps`);
  return entries.map((e) => {
    const { items, rest } = parseItems(e.body, (k) => k === "scripts");
    const step: Record<string, unknown> = { id: e.id };
    if (e.title) step.name = e.title;
    const instructions = rest.trim();
    if (instructions) step.instructions = instructions;
    const ids = items.flatMap((it) => it.text.split(",").map((s) => s.trim()).filter(Boolean));
    if (ids.length > 0) step.scripts = ids;
    return step as unknown as FlowStep;
  });
}

function parseScripts(body: string, languages: string[], path: string): ScriptLine[] {
  const { lead, entries } = splitEntries(body);
  if (lead.trim() !== "") throw new Error(`${path}: text before the first "### s_id" script heading`);
  const isLang = (k: string) => languages.includes(k);
  return entries.map((e) => {
    const { items, rest } = parseItems(e.body, isLang);
    const paragraph = rest.trim();
    const line: Record<string, unknown> = { id: e.id };
    const variations: Record<string, string[]> = {};
    if (paragraph) {
      // Plain-string text; every language line is a variation.
      line.text = paragraph;
      for (const it of items) (variations[it.key] ??= []).push(it.text);
    } else {
      const text: Record<string, string> = {};
      for (const it of items) {
        if (it.key in text) (variations[it.key] ??= []).push(it.text);
        else text[it.key] = it.text;
      }
      line.text = Object.keys(text).length > 0 ? text : "";
    }
    if (Object.keys(variations).length > 0) line.variations = variations;
    return line as unknown as ScriptLine;
  });
}

// Undo the frontmatter shorthands (see decompose.ts frontmatterForFlow).
function frontmatterToFlowFields(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...meta };
  if (typeof meta.entry_condition === "string") {
    out.entry_condition = { expression: meta.entry_condition, method: "llm" };
  }
  if (Array.isArray(meta.exit_paths)) {
    out.exit_paths = (meta.exit_paths as Array<Record<string, unknown>>).map((xp) => {
      const o: Record<string, unknown> = { ...xp };
      if (typeof o.condition === "string") o.condition = { expression: o.condition, method: "llm" };
      if (Array.isArray(o.actions)) {
        o.actions = (o.actions as unknown[]).map((a) => (typeof a === "string" ? { capability_id: a } : a));
      }
      return o as unknown as ExitPath;
    });
  }
  return out;
}

// ---------- helpers ----------

function collectionPaths(files: FileMap, fileName: string, dirRe: RegExp): string[] {
  return Object.keys(files).filter((p) => p === fileName || dirRe.test(p)).sort();
}

function collect<E>(
  files: FileMap,
  errors: LoadError[],
  fileName: string,
  dirRe: RegExp,
  parse: (text: string, path: string) => E[],
): E[] {
  const out: E[] = [];
  for (const path of collectionPaths(files, fileName, dirRe)) {
    const entries = attempt(errors, path, () => parse(files[path], path));
    if (entries) out.push(...entries);
  }
  return out;
}

function asArray<E>(v: unknown, path: string): E[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`${path}: expected a YAML list`);
  return v as E[];
}

function uniqueById<E extends { id: string }>(entries: E[], label: string, errors: LoadError[]): E[] {
  const seen = new Set<string>();
  const out: E[] = [];
  for (const e of entries) {
    if (seen.has(e.id)) {
      errors.push({ message: `duplicate ${label} id "${e.id}"` });
      continue;
    }
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

// A collection file may open with a title heading for readers; it carries no data.
function stripHeadings(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !/^# /.test(l))
    .join("\n");
}

function attempt<T>(errors: LoadError[], path: string, fn: () => T): T | null {
  try {
    return fn();
  } catch (e) {
    errors.push({ path, message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

function dropUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
