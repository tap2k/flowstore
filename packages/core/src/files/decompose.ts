import type { Spec, Flow, Agent, ScriptLine } from "@flowstore/core/schema/v0";
import { flowToScriptsCsv } from "@flowstore/core/codegen/scriptsCsv";
import { tableToCsv } from "@flowstore/core/codegen/knowledgeCsv";
import type { FileMap } from "./types";

const PROJECT_MANIFEST = { $schema: "flowstore://project/v0" } as const;

export interface DecomposeOptions {
  projectName?: string;
}

export function decomposeSpec(spec: Spec, opts: DecomposeOptions = {}): FileMap {
  const out: FileMap = {};

  out["flowstore.json"] = stringifyJson(PROJECT_MANIFEST);
  out["agent.json"] = stringifyJson(buildAgentFile(spec.agent));

  const glossary = spec.agent.knowledge?.glossary;
  if (glossary && glossary.length > 0) {
    out["knowledge/glossary.json"] = stringifyJson({
      $schema: "flowstore://project-glossary/v0",
      glossary,
    });
  }

  for (const table of spec.agent.knowledge?.tables ?? []) {
    const { rows: _rows, ...meta } = table;
    out[`knowledge/tables/${table.id}.meta.json`] = stringifyJson({
      $schema: "flowstore://knowledge-table/v0",
      ...meta,
    });
    out[`knowledge/tables/${table.id}.csv`] = tableToCsv(table);
  }

  const languages = spec.agent.meta.languages ?? [];
  for (const flow of spec.flows) {
    out[`flows/${flow.id}.flow.json`] = stringifyJson(buildFlowFile(flow));
    if (flow.scripts && flow.scripts.length > 0) {
      out[`flows/${flow.id}.scripts.csv`] = flowToScriptsCsv(flow, languages);
    }
  }

  out["README.md"] = scaffoldReadme(spec, opts);

  return out;
}

// Agent envelope, minus what's promoted out to project-scope files (glossary,
// tables). knowledge.faq stays inline as agent-scope.
function buildAgentFile(agent: Agent): Agent {
  const next: Agent = { ...agent };
  const faq = agent.knowledge?.faq;
  if (faq && faq.length > 0) {
    next.knowledge = { faq };
  } else {
    delete (next as { knowledge?: unknown }).knowledge;
  }
  return next;
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
    "- `agent.json` — agent envelope",
    "- `flows/` — per-flow behavior (`.flow.json`) + utterances (`.scripts.csv`)",
    "- `knowledge/` — project-scope glossary and tables",
    "",
    "See the flowstore file-model docs for the on-disk layout.",
    "",
  ];
  return lines.join("\n");
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
