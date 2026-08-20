// Dev CLI: render a project's compiled system prompt to stdout. Accepts the
// same inputs as flowstore-compile (project directory or .flowstore.json
// bundle) — it IS flowstore-compile --format prompt minus the options, kept
// as the documented codegen-iteration loop.
import { generateSystemPrompt } from "@flowstore/core/codegen/promptGenerator";
import { loadProjectFromPath } from "@flowstore/core/files/node";

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx scripts/preview-prompt.ts <project-dir|bundle.flowstore.json>");
  process.exit(1);
}

const result = loadProjectFromPath(path);
for (const e of result.errors) {
  console.error(`  ${e.path ? `${e.path}: ` : ""}${e.message}`);
}
if (!result.spec) {
  console.error("failed to load project");
  process.exit(1);
}
process.stdout.write(generateSystemPrompt(result.spec));
