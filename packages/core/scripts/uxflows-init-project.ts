import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { decomposeSpec } from "@uxflows/core/files";
import { writeFileMapToDirectory } from "@uxflows/core/files/node";
import type { Spec } from "@uxflows/core/schema/v0";

interface Args {
  from?: string;
  target?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") args.from = argv[++i];
    else if (a === "--target") args.target = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.from || !args.target) {
  console.error("usage: uxflows-init-project --from <spec.json> --target <dir>");
  process.exit(2);
}

const sourcePath = resolve(args.from);
const targetDir = resolve(args.target);

if (existsSync(targetDir) && readdirSync(targetDir).some((n) => n !== ".DS_Store")) {
  console.error(`target directory not empty: ${targetDir}`);
  console.error("refusing to overwrite — pick an empty or non-existent path");
  process.exit(1);
}

const spec = JSON.parse(readFileSync(sourcePath, "utf8")) as Spec;
const fileMap = decomposeSpec(spec);
writeFileMapToDirectory(fileMap, targetDir);

console.log(`wrote ${Object.keys(fileMap).length} files to ${targetDir}`);
