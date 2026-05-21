import { readFileSync } from "node:fs";
import { generateSystemPrompt } from "@ux4/core/codegen/promptGenerator";
import type { Spec } from "@ux4/core/schema/v0";

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx scripts/preview-prompt.ts <spec.json>");
  process.exit(1);
}

const spec = JSON.parse(readFileSync(path, "utf8")) as Spec;
process.stdout.write(generateSystemPrompt(spec));
