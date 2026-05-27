import type { Spec, Flow, Agent, ScriptLine } from "@flowstore/core/schema/v0";
import { flowToScriptsCsv } from "@flowstore/core/codegen/scriptsCsv";
import { tableToCsv } from "@flowstore/core/codegen/knowledgeCsv";
import type { FileMap } from "./types";

const PROJECT_MANIFEST = { $schema: "flowstore://spec/project/v0" } as const;

export interface DecomposeOptions {
  projectName?: string;
}

export function decomposeSpec(spec: Spec, opts: DecomposeOptions = {}): FileMap {
  const out: FileMap = {};
  const agent = spec.agent;

  out["flowstore.json"] = stringifyJson(PROJECT_MANIFEST);
  out["agent.json"] = stringifyJson(buildAgentFile(agent));

  // Project-scope collections promoted out of agent.json into their own files
  // (FILE-MODEL § "Scope collections — physical layout"). The loader merges
  // them back; round-trip is exact modulo collection ordering.
  if (agent.guardrails && agent.guardrails.length > 0) {
    out["guardrails.json"] = stringifyJson({
      $schema: "flowstore://spec/guardrails/v0",
      guardrails: agent.guardrails,
    });
  }

  if (agent.business_goals && agent.business_goals.length > 0) {
    out["business-goals.json"] = stringifyJson({
      $schema: "flowstore://spec/business-goals/v0",
      business_goals: agent.business_goals,
    });
  }

  if (agent.variables && Object.keys(agent.variables).length > 0) {
    out["variables.json"] = stringifyJson({
      $schema: "flowstore://spec/variables/v0",
      variables: agent.variables,
    });
  }

  for (const capability of agent.capabilities ?? []) {
    out[`capabilities/${capability.id}.capability.json`] = stringifyJson({
      $schema: "flowstore://spec/capability/v0",
      ...capability,
    });
  }

  const faq = agent.knowledge?.faq;
  if (faq && faq.length > 0) {
    out["knowledge/faq.json"] = stringifyJson({
      $schema: "flowstore://spec/faq/v0",
      faq,
    });
  }

  const glossary = agent.knowledge?.glossary;
  if (glossary && glossary.length > 0) {
    out["knowledge/glossary.json"] = stringifyJson({
      $schema: "flowstore://spec/project-glossary/v0",
      glossary,
    });
  }

  for (const table of agent.knowledge?.tables ?? []) {
    const { rows: _rows, ...meta } = table;
    out[`knowledge/tables/${table.id}.meta.json`] = stringifyJson({
      $schema: "flowstore://spec/knowledge-table/v0",
      ...meta,
    });
    out[`knowledge/tables/${table.id}.csv`] = tableToCsv(table);
  }

  const languages = agent.meta.languages ?? [];
  for (const flow of spec.flows) {
    out[`flows/${flow.id}.flow.json`] = stringifyJson(buildFlowFile(flow));
    if (flow.scripts && flow.scripts.length > 0) {
      out[`flows/${flow.id}.scripts.csv`] = flowToScriptsCsv(flow, languages);
    }
  }

  out["README.md"] = scaffoldReadme(spec, opts);

  return out;
}

// Agent envelope, minus everything promoted to its own file: guardrails,
// business goals, variables, capabilities, and all of knowledge (faq,
// glossary, tables). What remains is the bare envelope — meta, entry flow,
// and the who-speaks-first flag.
function buildAgentFile(agent: Agent): Agent {
  const {
    guardrails: _guardrails,
    business_goals: _businessGoals,
    capabilities: _capabilities,
    variables: _variables,
    knowledge: _knowledge,
    ...rest
  } = agent;
  void _guardrails;
  void _businessGoals;
  void _capabilities;
  void _variables;
  void _knowledge;
  return rest as Agent;
}

// Flow file holds per-script metadata (id + optional variations); text lives
// in the paired .scripts.csv since translators bulk-edit it. Variations stay
// here because the CSV's flat shape can't carry per-language arrays.
function buildFlowFile(flow: Flow): Omit<Flow, "scripts"> & {
  scripts?: Array<{ id: string; variations?: ScriptLine["variations"] }>;
} {
  const { scripts, ...rest } = flow;
  if (!scripts || scripts.length === 0) return rest;
  const slim = scripts.map(({ id, variations }) => {
    const entry: { id: string; variations?: ScriptLine["variations"] } = { id };
    if (variations !== undefined) entry.variations = variations;
    return entry;
  });
  return { ...rest, scripts: slim };
}

function scaffoldReadme(spec: Spec, opts: DecomposeOptions): string {
  const name = opts.projectName ?? spec.agent.meta.name ?? spec.agent.id;
  const lines = [
    `# ${name}`,
    "",
    spec.agent.meta.purpose ?? "",
    "",
    "Authored in flowstore. Spec files are decomposed under this directory:",
    "",
    "- `flowstore.json` — project manifest",
    "- `agent.json` — agent envelope (meta, entry flow)",
    "- `guardrails.json`, `business-goals.json`, `variables.json` — project-scope collections",
    "- `capabilities/` — capability declarations (`.capability.json`) + test mocks (`.mock.json`)",
    "- `knowledge/` — FAQ, glossary, and tables",
    "- `flows/` — per-flow behavior (`.flow.json`) + utterances (`.scripts.csv`)",
    "",
    "See the flowstore file-model docs for the on-disk layout.",
    "",
  ];
  return lines.join("\n");
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
