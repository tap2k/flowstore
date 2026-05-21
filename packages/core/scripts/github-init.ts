import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Octokit } from "@octokit/rest";
import { decomposeSpec } from "@ux4/core/files";
import { writeFileMapToRepo } from "@ux4/core/files/github";
import type { Spec } from "@ux4/core/schema/v0";

// Initialize a UX4 project in a real GitHub repo by decomposing a single-file
// spec and committing it to the named branch (default: main). Uses base_tree
// to inherit anything already in the branch (README, supplementary docs).
// One commit, atomic. Idempotent in spirit — re-running re-writes the same
// canonical files; old UX4 content not in the new spec is NOT cleaned up
// (treat the target as a smoke / fresh repo).
//
//   GH_TOKEN=ghp_xxx GH_REPO=owner/name GH_SPEC=path/to/spec.json npm -w @ux4/core run github-init
//
// Optional: GH_BRANCH (default: main)

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

const branch = process.env.GH_BRANCH ?? "main";
const source = JSON.parse(readFileSync(specPath, "utf8")) as Spec;
const fileMap = decomposeSpec(source);
const client = new Octokit({ auth: token });
const message = `Initialize UX4 project from ${basename(specPath)}`;

writeFileMapToRepo({ client, owner, repo, ref: branch }, fileMap, message)
  .then((res) => {
    console.log(`wrote ${Object.keys(fileMap).length} files to ${owner}/${repo}@${branch}`);
    console.log(`commit ${res.commitSha.slice(0, 7)} (tree ${res.treeSha.slice(0, 7)})`);
  })
  .catch((e: unknown) => {
    console.error("FAIL:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
