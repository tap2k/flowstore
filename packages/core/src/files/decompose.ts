import type { Spec, Flow, Agent, ScriptLine } from "@flowstore/core/schema/v0";
import type { FileMap } from "./types";
import { formatItem, formatLocalized, formatTable, joinFrontmatter, toYaml } from "./markdown";

// Spec → source files. The inverse of loadProject (load.ts); the two are
// pinned together by the round-trip tests. Layout (FILE-MODEL.md):
//
//   flowstore.yaml               manifest
//   agent.md                     envelope in frontmatter; body = system_prompt
//   guardrails.md                - id: statement
//   business-goals.yaml
//   variables.yaml
//   capabilities/<id>.md         frontmatter = declaration; body = description
//   knowledge/faq.md             ### id: question / answer
//   knowledge/glossary.md        ### id: term / definition
//   knowledge/tables/<id>.md     frontmatter = structure; body = pipe table
//   flows/<id>.md                frontmatter = routing; body = instructions,
//                                ## Scripts, ## Guardrails, ## FAQ, ## Example, ## Notes

export const PROJECT_MANIFEST = { $schema: "flowstore://spec/project/v1" } as const;

export interface DecomposeOptions {
  projectName?: string;
}

export function decomposeSpec(spec: Spec, opts: DecomposeOptions = {}): FileMap {
  const out: FileMap = {};
  const agent = spec.agent;

  out["flowstore.yaml"] = toYaml(PROJECT_MANIFEST);
  out["agent.md"] = emitAgent(agent);

  if (agent.guardrails && agent.guardrails.length > 0) {
    out["guardrails.md"] = emitGuardrails(agent.guardrails);
  }
  if (agent.business_goals && agent.business_goals.length > 0) {
    out["business-goals.yaml"] = toYaml(agent.business_goals);
  }
  if (agent.variables && Object.keys(agent.variables).length > 0) {
    out["variables.yaml"] = toYaml(agent.variables);
  }
  for (const capability of agent.capabilities ?? []) {
    const { id, description, ...meta } = capability;
    out[`capabilities/${id}.md`] = joinFrontmatter(meta, description);
  }

  const faq = agent.knowledge?.faq;
  if (faq && faq.length > 0) out["knowledge/faq.md"] = emitFaq(faq);

  const glossary = agent.knowledge?.glossary;
  if (glossary && glossary.length > 0) {
    out["knowledge/glossary.md"] = glossary
      .map((g) => `### ${g.id}: ${g.term}\n${g.definition}\n`)
      .join("\n");
  }

  for (const table of agent.knowledge?.tables ?? []) {
    const { id, rows, ...meta } = table;
    const fields = table.structure.map((f) => f.field);
    const header = fields.length > 0 ? fields : Object.keys(rows[0] ?? {});
    out[`knowledge/tables/${id}.md`] = joinFrontmatter(meta, formatTable(header, rows));
  }

  for (const flow of spec.flows) {
    out[`flows/${flow.id}.md`] = emitFlow(flow);
  }

  return out;
}

export function emitAgent(agent: Agent): string {
  const {
    $schema: _schema,
    id,
    name,
    version,
    meta,
    chatbot_initiates,
    system_prompt,
    entry_flow_id,
    notes,
    // Project-scope collections have their own files.
    guardrails: _g,
    business_goals: _b,
    capabilities: _c,
    variables: _v,
    knowledge: _k,
    ...rest
  } = agent;
  void _schema; void _g; void _b; void _c; void _v; void _k;
  // meta is flattened into the frontmatter; parseAgent folds AGENT_META_KEYS back.
  const front: Record<string, unknown> = {
    id,
    name,
    version,
    ...meta,
    chatbot_initiates,
    entry_flow_id,
    notes,
    ...rest,
  };
  return joinFrontmatter(front, system_prompt ?? "");
}

function emitGuardrails(guardrails: Array<{ id: string; statement: string }>): string {
  return guardrails.map((g) => formatItem(g.id, g.statement)).join("\n") + "\n";
}

type FaqEntry = { id: string; question: string; answer: string | Record<string, string> };

export function emitFaq(entries: FaqEntry[]): string {
  return entries
    .map((e) => `### ${e.id}: ${e.question}\n${formatLocalized(e.answer)}\n`)
    .join("\n");
}

export function emitFlow(flow: Flow): string {
  const {
    $schema: _schema,
    id: _id,
    name,
    instructions,
    steps,
    scripts,
    guardrails,
    knowledge,
    example,
    notes,
    ...front
  } = flow;
  void _schema; void _id;

  const parts: string[] = [`# ${name}`];
  if (instructions !== undefined) parts.push("", instructions.replace(/\s+$/, ""));

  if (steps && steps.length > 0) {
    parts.push("", "## Steps");
    for (const st of steps) {
      parts.push("", `### ${st.id}${st.name ? `: ${st.name}` : ""}`);
      if (st.instructions !== undefined) parts.push(st.instructions.replace(/\s+$/, ""));
      if (st.scripts && st.scripts.length > 0) parts.push(formatItem("scripts", st.scripts.join(", ")));
    }
  }
  if (scripts && scripts.length > 0) {
    parts.push("", "## Scripts");
    for (const s of scripts) parts.push("", ...emitScript(s));
  }
  if (guardrails && guardrails.length > 0) {
    parts.push("", "## Guardrails", "", ...guardrails.map((g) => formatItem(g.id, g.statement)));
  }
  if (knowledge?.faq && knowledge.faq.length > 0) {
    parts.push("", "## FAQ", "", emitFaq(knowledge.faq).replace(/\s+$/, ""));
  }
  if (example !== undefined) parts.push("", "## Example", "", example.replace(/\s+$/, ""));
  if (notes !== undefined) parts.push("", "## Notes", "", notes.replace(/\s+$/, ""));

  return joinFrontmatter(frontmatterForFlow(front), parts.join("\n"));
}

// A script is `### id`, then its text (a paragraph for a plain string, or
// `- lang: text` lines for a per-language map), then any variations as
// further `- lang: text` lines. A paragraph followed by lines is therefore
// unambiguous: the paragraph is the text, every line is a variation.
function emitScript(s: ScriptLine): string[] {
  const lines = [`### ${s.id}`];
  if (typeof s.text === "string") lines.push(s.text.replace(/\s+$/, ""));
  else for (const [lang, t] of Object.entries(s.text)) lines.push(formatItem(lang, t));
  for (const [lang, alts] of Object.entries(s.variations ?? {})) {
    for (const alt of alts) lines.push(formatItem(lang, alt));
  }
  return lines;
}

// Frontmatter shorthands that read better than the schema's nested objects.
// The parser (load.ts) accepts both the shorthand and the long form.
//   condition: "<expr>"         ≡ { expression, method: "llm" }
//   actions: [cap_id, ...]      ≡ [{ capability_id }, ...]
function frontmatterForFlow(front: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...front };
  if (Array.isArray(front.exit_paths)) {
    out.exit_paths = (front.exit_paths as Array<Record<string, unknown>>).map((xp) => {
      const o: Record<string, unknown> = { ...xp };
      if (isLlmCondition(o.condition)) o.condition = (o.condition as { expression: string }).expression;
      if (Array.isArray(o.actions)) {
        o.actions = (o.actions as Array<{ capability_id: string }>).map((a) => a.capability_id);
      }
      return o;
    });
  }
  if (isLlmCondition(front.entry_condition)) {
    out.entry_condition = (front.entry_condition as { expression: string }).expression;
  }
  return out;
}

function isLlmCondition(c: unknown): boolean {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  return o.method === "llm" && o.pattern === undefined && Object.keys(o).length === 2;
}

// Written once by flowstore-init-project; never on save, so a hand-written
// README survives editor saves.
export function scaffoldReadme(spec: Spec, opts: DecomposeOptions = {}): string {
  const name = opts.projectName ?? spec.agent.name ?? spec.agent.id;
  const lines = [
    `# ${name}`,
    "",
    spec.agent.meta.purpose ?? "",
    "",
    "A flowstore project. The spec is markdown with YAML frontmatter:",
    "",
    "- `agent.md` — identity, languages, entry flow; body is the system prompt template if any",
    "- `flows/<id>.md` — one flow per file: routing in frontmatter, instructions and scripts in the body",
    "- `guardrails.md`, `knowledge/` — rules, FAQ, glossary, tables",
    "- `variables.yaml`, `business-goals.yaml`, `capabilities/` — machine-facing declarations",
    "- `tests/` — cases, personas, rubrics, golds",
    "",
    "See FILE-MODEL.md in the flowstore repo for the layout.",
    "",
  ];
  return lines.join("\n");
}
