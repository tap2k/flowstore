import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { decomposeSpec, loadProject } from "@uxflows/core/files";
import { readDirectoryToFileMap, writeFileMapToDirectory } from "@uxflows/core/files/node";
import { generateSystemPrompt } from "@uxflows/core/codegen/promptGenerator";
import type { Spec } from "@uxflows/core/schema/v0";

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx scripts/round-trip-disk.ts <spec.json>");
  process.exit(2);
}

const source = JSON.parse(readFileSync(path, "utf8")) as Spec;

const tmp = mkdtempSync(join(tmpdir(), "uxflows-roundtrip-"));
try {
  writeFileMapToDirectory(decomposeSpec(source), tmp);
  const reread = readDirectoryToFileMap(tmp);
  const { spec: resolved, errors } = loadProject(reread);

  if (errors.length > 0) {
    console.error("load errors:");
    for (const e of errors) console.error(" -", e.path ? `${e.path}:` : "", e.message);
  }
  if (!resolved) {
    console.error("FAIL: loadProject returned null");
    process.exit(1);
  }

  const a = JSON.parse(JSON.stringify(sortFlowsById(source)));
  const b = JSON.parse(JSON.stringify(sortFlowsById(resolved)));
  const diff = deepDiff(a, b, []);
  if (diff.length > 0) {
    console.error("FAIL: disk round-trip diff (first 20):");
    for (const d of diff.slice(0, 20)) console.error(" -", d);
    console.error(`(${diff.length} total)`);
    process.exit(1);
  }

  // The loader returns flows sorted by id (lookup is by id, not position).
  // Normalize source the same way so the codegen sees identical input on both
  // sides — what we're asserting is that the resolved spec compiles to the
  // same prompt as the source, given the canonical flow order.
  const promptSrc = generateSystemPrompt(sortFlowsById(source));
  const promptLoaded = generateSystemPrompt(sortFlowsById(resolved));
  if (promptSrc !== promptLoaded) {
    console.error("FAIL: system prompt differs after round-trip");
    console.error(`source length: ${promptSrc.length}, loaded length: ${promptLoaded.length}`);
    process.exit(1);
  }

  console.log(`OK: disk round-trip lossless via ${tmp} (prompt ${promptSrc.length} chars)`);
  process.exit(0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function sortFlowsById(spec: Spec): Spec {
  return { ...spec, flows: [...spec.flows].sort((a, b) => a.id.localeCompare(b.id)) };
}

function deepDiff(a: unknown, b: unknown, path: string[]): string[] {
  if (a === b) return [];
  const at = typeOf(a);
  const bt = typeOf(b);
  if (at !== bt) return [`${path.join(".") || "(root)"}: type ${at} vs ${bt}`];
  if (at === "array") {
    const aa = a as unknown[];
    const ba = b as unknown[];
    const diffs: string[] = [];
    if (aa.length !== ba.length) diffs.push(`${path.join(".") || "(root)"}: array length ${aa.length} vs ${ba.length}`);
    const n = Math.max(aa.length, ba.length);
    for (let i = 0; i < n; i++) diffs.push(...deepDiff(aa[i], ba[i], [...path, String(i)]));
    return diffs;
  }
  if (at === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    const diffs: string[] = [];
    for (const k of keys) diffs.push(...deepDiff(ao[k], bo[k], [...path, k]));
    return diffs;
  }
  return [`${path.join(".") || "(root)"}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`];
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
