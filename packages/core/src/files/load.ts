import type { Spec, Agent, Flow } from "@ux4/core/schema/v0";
import { validateSpec } from "@ux4/core/validation/ajv";
import { mergeScriptsCsv } from "@ux4/core/codegen/scriptsCsv";
import { parseTableRowsCsv } from "@ux4/core/codegen/knowledgeCsv";
import type { FileMap, LoadError, LoadResult } from "./types";

const FLOW_FILE_RE = /^flows\/(.+)\.flow\.json$/;
const FLOW_SCRIPTS_RE = /^flows\/(.+)\.scripts\.csv$/;
const TABLE_META_RE = /^knowledge\/tables\/(.+)\.meta\.json$/;

export function loadProject(files: FileMap): LoadResult {
  const errors: LoadError[] = [];

  const agentRaw = files["agent.json"];
  if (agentRaw === undefined) {
    return { spec: null, errors: [{ message: "missing agent.json at project root" }] };
  }

  const agent = parseJson<Agent>(agentRaw, "agent.json", errors);
  if (!agent) return { spec: null, errors };

  // Project-scope: knowledge/glossary.json (file form). Directory form
  // (knowledge/glossary/<sub>.json) ships when a real spec uses it.
  const glossaryRaw = files["knowledge/glossary.json"];
  if (glossaryRaw !== undefined) {
    const glossaryFile = parseJson<{ glossary?: unknown[] }>(
      glossaryRaw,
      "knowledge/glossary.json",
      errors,
    );
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
      flow.scripts = mergeScriptsCsv(csv, [], languages);
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
    return { spec: null, errors };
  }

  return { spec: result.spec, errors };
}

function parseJson<T>(text: string, path: string, errors: LoadError[]): T | null {
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    errors.push({ path, message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
