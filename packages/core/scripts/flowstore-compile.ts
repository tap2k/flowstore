import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadProjectFromPath } from "@flowstore/core/files/node";
import type { LoadResult } from "@flowstore/core/files";
import { generateSystemPrompt } from "@flowstore/core/codegen/promptGenerator";
import { capabilityToolDefinitions } from "@flowstore/core/llm/capabilityTools";
import type { Spec } from "@flowstore/core/schema/v0";

interface Args {
  format: "prompt" | "spec";
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
      if (v !== "prompt" && v !== "spec") {
        usage(`unknown --format "${v}"; expected "prompt" or "spec"`);
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
    "usage: flowstore-compile <project-dir|bundle.flowstore.json> --format prompt|spec [--agent <id>] [--out <path>] [--vars k=v,k=v] [--vars-file <path.json>] [--language <code>]",
  );
  process.exit(2);
}

function loadSpec(input: string): Spec {
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
  return result.spec;
}

function emit(text: string, out?: string): void {
  if (out) writeFileSync(resolve(out), text, "utf8");
  else process.stdout.write(text);
}

const args = parseArgs(process.argv.slice(2));
const spec = loadSpec(args.input);

if (args.format === "prompt") {
  const system_prompt = generateSystemPrompt(spec, args.vars, {
    language: args.language,
  });
  const tool_schemas = capabilityToolDefinitions(spec, { closed: true });
  emit(JSON.stringify({ system_prompt, tool_schemas }, null, 2) + "\n", args.out);
} else {
  emit(JSON.stringify(spec, null, 2) + "\n", args.out);
}
