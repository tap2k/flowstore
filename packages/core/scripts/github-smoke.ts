import { readFileSync } from "node:fs";
import { Octokit } from "@octokit/rest";
import { decomposeSpec, loadProject } from "@ux4/core/files";
import {
  readRepoToFileMap,
  writeFileMapToRepo,
  type GitHubLocation,
} from "@ux4/core/files/github";
import type { Spec } from "@ux4/core/schema/v0";

// Round-trips a local single-file spec through a temporary branch in a real
// GitHub repo, then reads it back and diffs. Cleans up the branch on success.
//
//   GH_TOKEN=ghp_xxx GH_REPO=owner/name GH_SPEC=path/to/spec.json npm -w @ux4/core run github-smoke
//
// Optional: GH_BRANCH (default: ux4-smoke-<unix-ts>)
//           GH_BASE   (default: main)
// The PAT needs `contents:write` on the target repo.

const token = process.env.GH_TOKEN;
const repoFull = process.env.GH_REPO;
const specPath = process.env.GH_SPEC;
if (!token || !repoFull || !specPath) {
  console.error("missing env: GH_TOKEN, GH_REPO (owner/name), GH_SPEC (path)");
  process.exit(2);
}

const [owner, repo] = repoFull.split("/");
if (!owner || !repo) {
  console.error(`bad GH_REPO ${repoFull}; expected owner/name`);
  process.exit(2);
}

const branch = process.env.GH_BRANCH ?? `ux4-smoke-${Date.now()}`;
const base = process.env.GH_BASE ?? "main";

const source = JSON.parse(readFileSync(specPath, "utf8")) as Spec;
const fileMap = decomposeSpec(source);

const client = new Octokit({ auth: token });

async function main() {
  console.log(`smoke against ${owner}/${repo}, branch ${branch} from ${base}`);

  // Create the smoke branch off base.
  const baseRef = await client.rest.git.getRef({ owner, repo, ref: `heads/${base}` });
  await client.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: baseRef.data.object.sha,
  });

  const loc: GitHubLocation = { client, owner, repo, ref: branch };
  try {
    const write = await writeFileMapToRepo(loc, fileMap, "UX4 smoke: write decomposed spec");
    console.log(`  wrote ${Object.keys(fileMap).length} files → commit ${write.commitSha.slice(0, 7)}`);

    const read = await readRepoToFileMap(loc);
    console.log(`  read ${Object.keys(read.files).length} files back`);

    const { spec: resolved, errors } = loadProject(read.files);
    for (const e of errors) console.error("  load error:", e.path ?? "", e.message);
    if (!resolved) throw new Error("loadProject returned null");

    const a = JSON.parse(JSON.stringify(sortFlowsById(source)));
    const b = JSON.parse(JSON.stringify(sortFlowsById(resolved)));
    const diff = deepDiff(a, b, []);
    if (diff.length > 0) {
      console.error("FAIL: round-trip diff (first 10):");
      for (const d of diff.slice(0, 10)) console.error(" -", d);
      throw new Error(`${diff.length} diff entries`);
    }
    console.log("  OK: GitHub round-trip lossless");
  } finally {
    await client.rest.git.deleteRef({ owner, repo, ref: `heads/${branch}` }).catch((e: unknown) => {
      console.warn("  cleanup: deleteRef failed:", e instanceof Error ? e.message : e);
    });
  }
}

main().catch((e: unknown) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});

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
    if (aa.length !== ba.length)
      diffs.push(`${path.join(".") || "(root)"}: array length ${aa.length} vs ${ba.length}`);
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
