import { readFileSync } from "node:fs";
import { generateSystemPrompt } from "@uxflows/core/codegen/promptGenerator";
import type { Spec } from "@uxflows/core/schema/v0";

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx scripts/preview-prompt.ts <spec.json>");
  process.exit(1);
}

const spec = JSON.parse(readFileSync(path, "utf8")) as Spec;
process.stdout.write(generateSystemPrompt(spec));
