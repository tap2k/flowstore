// Convert between the canonical decomposed project layout and the
// .flowstore.json bundle envelope. Both directions route through the model
// (loadProject → re-decompose), so conversion also NORMALIZES: unknown files
// are dropped, collections land in their canonical paths. The decomposed
// layout in git is the only canonical form; the bundle is interchange.
//
//   flowstore-convert <project-dir|bundle.flowstore.json> --to bundle|dir --out <path>
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadProjectFromPath, writeFileMapToDirectory } from "@flowstore/core/files/node";
import {
  decomposeSpec,
  decomposeTestingArtifacts,
  decomposeModelsConfig,
  decomposeComments,
} from "@flowstore/core/files";
import type { FileMap } from "@flowstore/core/files";

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error("usage: flowstore-convert <project-dir|bundle.flowstore.json> --to bundle|dir --out <path>");
  process.exit(2);
}

let input: string | null = null;
let to: "bundle" | "dir" | null = null;
let out: string | null = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--to") {
    const v = argv[++i];
    if (v !== "bundle" && v !== "dir") usage(`unknown --to "${v}"`);
    to = v;
  } else if (a === "--out") out = argv[++i];
  else if (!input) input = a;
  else usage(`unexpected argument: ${a}`);
}
if (!input || !to || !out) usage();
if (!existsSync(resolve(input))) usage(`input not found: ${input}`);

const result = loadProjectFromPath(resolve(input));
for (const e of result.errors) {
  console.error(`  ${e.path ? `${e.path}: ` : ""}${e.message}`);
}
for (const ig of result.testingArtifacts.ignored) {
  console.error(`  skipped ${ig.path}: ${ig.reason}`);
}
if (!result.spec) {
  console.error("failed to load project");
  process.exit(1);
}

const files: FileMap = {
  ...decomposeSpec(result.spec),
  ...decomposeTestingArtifacts(result.testingArtifacts),
  ...decomposeModelsConfig(result.modelsConfig),
  ...decomposeComments(result.comments),
};

if (to === "bundle") {
  writeFileSync(resolve(out), JSON.stringify(files, null, 2) + "\n", "utf8");
} else {
  writeFileMapToDirectory(files, resolve(out));
}
console.error(`wrote ${Object.keys(files).length} project files as ${to} -> ${out}`);
