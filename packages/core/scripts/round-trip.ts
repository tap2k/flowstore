import { readFileSync } from "node:fs";
import { decomposeSpec, loadProject } from "@ux4/core/files";
import type { Spec } from "@ux4/core/schema/v0";

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx scripts/round-trip.ts <spec.json>");
  process.exit(2);
}

const source = JSON.parse(readFileSync(path, "utf8")) as Spec;
const fileMap = decomposeSpec(source);
const { spec: resolved, errors } = loadProject(fileMap);

if (errors.length > 0) {
  console.error("load errors:");
  for (const e of errors) console.error(" -", e.path ? `${e.path}: ` : "", e.message);
}

if (!resolved) {
  console.error("FAIL: loadProject returned null");
  process.exit(1);
}

// Normalize: drop undefined fields, plain objects only, key-order-independent
// deep equality. Flow order is presentational (lookup is by id, not index),
// so sort both sides by id before comparing.
const normalizedSource = normalize(sortFlowsById(source));
const normalizedResolved = normalize(sortFlowsById(resolved));

const diff = deepDiff(normalizedSource, normalizedResolved, []);
if (diff.length === 0) {
  console.log(`OK: round-trip lossless (${Object.keys(fileMap).length} files emitted, ${source.flows.length} flows)`);
  process.exit(0);
}

console.error("FAIL: round-trip diff (first 20 paths):");
for (const d of diff.slice(0, 20)) console.error(" -", d);
console.error(`(${diff.length} total diff entries)`);
process.exit(1);

function normalize(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v));
}

function sortFlowsById(spec: Spec): Spec {
  return { ...spec, flows: [...spec.flows].sort((a, b) => a.id.localeCompare(b.id)) };
}

function deepDiff(a: unknown, b: unknown, path: string[]): string[] {
  if (a === b) return [];
  const at = typeOf(a);
  const bt = typeOf(b);
  if (at !== bt) return [`${joinPath(path)}: type ${at} vs ${bt}`];
  if (at === "array") {
    const aa = a as unknown[];
    const ba = b as unknown[];
    const diffs: string[] = [];
    if (aa.length !== ba.length) diffs.push(`${joinPath(path)}: array length ${aa.length} vs ${ba.length}`);
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
  return [`${joinPath(path)}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`];
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function joinPath(p: string[]): string {
  return p.length === 0 ? "(root)" : p.join(".");
}
