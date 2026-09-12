import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadProjectFromPath } from "@flowstore/core/files/node";
import type { LoadResult } from "@flowstore/core/files";
import { generateSystemPrompt } from "@flowstore/core/codegen/promptGenerator";
import { capabilityToolDefinitions } from "@flowstore/core/llm/capabilityTools";
import type { Spec } from "@flowstore/core/schema/v0";
import { compileProvenance, specHash } from "@flowstore/core/spec/provenance";

const COMPILER = `flowstore-compile ${(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version}`;

interface Args {
  format: "prompt" | "spec" | "tests";
  input: string;
  out?: string;
  vars?: Record<string, unknown>;
  language?: string;
  agent?: string; // accepted but not yet meaningful (single-agent today)
}

function parseArgs(argv: string[]): Args {
  let format: Args["format"] | null = null;
  let input: string | null = null;
  let out: string | undefined;
  let language: string | undefined;
  let agent: string | undefined;
  let vars: Record<string, unknown> | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format") {
      const v = argv[++i];
      if (v !== "prompt" && v !== "spec" && v !== "tests") {
        usage(`unknown --format "${v}"; expected "prompt", "spec" or "tests"`);
      }
      format = v as Args["format"];
    } else if (a === "--out") {
      out = argv[++i];
    } else if (a === "--vars") {
      vars = parseVars(argv[++i]);
    } else if (a === "--vars-file") {
      const path = argv[++i];
      const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as Record<string, unknown>;
      vars = { ...(vars ?? {}), ...parsed };
    } else if (a === "--language") {
      language = argv[++i];
    } else if (a === "--agent") {
      agent = argv[++i];
    } else if (a === "--help" || a === "-h") {
      usage();
    } else if (!input) {
      input = a;
    } else {
      usage(`unexpected argument: ${a}`);
    }
  }
  if (!format) usage("missing --format");
  if (!input) usage("missing input (project directory or .flowstore.json bundle)");
  return { format: format!, input: input!, out, vars, language, agent };
}

function parseVars(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const out: Record<string, unknown> = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return out;
}

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error(
    "usage: flowstore-compile <project-dir|bundle.flowstore.json> --format prompt|spec|tests [--agent <id>] [--out <path>] [--vars k=v,k=v] [--vars-file <path.json>] [--language <code>]",
  );
  process.exit(2);
}

function loadResult(input: string): LoadResult {
  const path = resolve(input);
  if (!existsSync(path)) {
    console.error(`input not found: ${path}`);
    process.exit(1);
  }
  let result: LoadResult;
  try {
    result = loadProjectFromPath(path);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  for (const err of result.errors) {
    console.error(`  ${err.path ? `${err.path}: ` : ""}${err.message}`);
  }
  // Surface (never hide) test files skipped for an unrecognized $schema —
  // forward-compat skips, but a typo'd $schema lands here too.
  for (const ig of result.testingArtifacts.ignored) {
    console.error(`  skipped ${ig.path}: ${ig.reason}`);
  }
  if (!result.spec) {
    console.error("failed to load project");
    process.exit(1);
  }
  return result;
}

function emit(text: string, out?: string): void {
  if (out) writeFileSync(resolve(out), text, "utf8");
  else process.stdout.write(text);
}

async function main(): Promise<void> {
const args = parseArgs(process.argv.slice(2));
const loaded = loadResult(args.input);
const spec = loaded.spec!;

if (args.format === "tests") {
  // Everything a harness needs besides the spec, already parsed: it never
  // reads test files or the models config itself.
  const t = loaded.testingArtifacts;
  emit(JSON.stringify({
    spec_hash: await specHash(spec),
    cases: t.testCases, personas: t.personas, rubrics: t.rubrics, golds: t.golds, decisions: t.decisions,
    models: loaded.modelsConfig ? { default: loaded.modelsConfig.default, roles: loaded.modelsConfig.roles, models: Object.keys(loaded.modelsConfig.models) } : null,
  }, null, 2) + "\n", args.out);
} else if (args.format === "prompt") {
  const system_prompt = generateSystemPrompt(spec, args.vars, {
    language: args.language,
  });
  const tool_schemas = capabilityToolDefinitions(spec, { closed: true });
  // Provenance binds a run to this compile: hash of the spec's canonical
  // normal form, hash of the emitted prompt. A runtime logs both per call.
  const provenance = await compileProvenance(spec, system_prompt, { language: args.language, compiler: COMPILER });
  emit(JSON.stringify({ system_prompt, tool_schemas, provenance }, null, 2) + "\n", args.out);
} else {
  emit(JSON.stringify(spec, null, 2) + "\n", args.out);
}
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
