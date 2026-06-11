import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readDirectoryToFileMap } from "@flowstore/core/files/node";
import { loadProject } from "@flowstore/core/files";
import { generateSystemPrompt } from "@flowstore/core/codegen/promptGenerator";
import type { Spec, Capability, VariableDecl } from "@flowstore/core/schema/v0";

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
  if (!input) usage("missing input (project directory or spec.json)");
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
    "usage: flowstore-compile <project-dir|spec.json> --format prompt|spec [--agent <id>] [--out <path>] [--vars k=v,k=v] [--vars-file <path.json>] [--language <code>]",
  );
  process.exit(2);
}

function loadSpec(input: string): Spec {
  const path = resolve(input);
  if (!existsSync(path)) {
    console.error(`input not found: ${path}`);
    process.exit(1);
  }
  if (statSync(path).isDirectory()) {
    const files = readDirectoryToFileMap(path);
    const result = loadProject(files);
    if (result.errors.length > 0) {
      for (const e of result.errors) {
        console.error(`  ${e.path ? `${e.path}: ` : ""}${e.message}`);
      }
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
  // Single-file spec (legacy / migration path).
  return JSON.parse(readFileSync(path, "utf8")) as Spec;
}

// Capability declarations carry variable names only. To make a JSON Schema
// tool definition useful, look up the variable's declared type on the agent;
// fall back to "string" when undeclared (matches generated-code default in
// other targets).
function variableType(
  varName: string,
  agentVars: Record<string, VariableDecl> | undefined,
): { type: string; enum?: string[] } {
  const decl = agentVars?.[varName];
  if (!decl) return { type: "string" };
  if (decl.type === "enum") {
    return {
      type: "string",
      enum: (decl.values as string[] | undefined) ?? [],
    };
  }
  if (decl.type === "number") return { type: "number" };
  if (decl.type === "boolean") return { type: "boolean" };
  return { type: "string" };
}

function toolSchemaForCapability(
  cap: Capability,
  agentVars: Record<string, VariableDecl> | undefined,
): unknown {
  const properties: Record<string, unknown> = {};
  for (const input of cap.inputs ?? []) {
    properties[input] = variableType(input, agentVars);
  }
  return {
    name: cap.name,
    description: cap.description,
    parameters: {
      type: "object",
      properties,
      required: cap.inputs ?? [],
      additionalProperties: false,
    },
  };
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
  const tool_schemas = (spec.agent.capabilities ?? []).map((c) =>
    toolSchemaForCapability(c, spec.agent.variables),
  );
  emit(JSON.stringify({ system_prompt, tool_schemas }, null, 2) + "\n", args.out);
} else {
  emit(JSON.stringify(spec, null, 2) + "\n", args.out);
}
