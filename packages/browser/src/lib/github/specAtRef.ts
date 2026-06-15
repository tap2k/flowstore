// Reconstruct a project's Spec and TestingArtifacts at any commit-ish, with a
// SHA-keyed cache.
//
// Shared by the chat git tools and (forthcoming) the Source Control panel, so
// reads at the same commit aren't repeated. A commit's tree is immutable, so a
// resolved commit SHA is a permanent cache key — no invalidation needed. We
// always resolve the commit-ish first (branch tips and tags move), then skip
// the expensive tree + blob read on a cache hit; only the cheap getCommit
// resolution runs every time.

import {
  resolveCommit,
  readRepoAtTree,
  type GitHubLocation,
} from "@flowstore/core/files/github";
import { loadProject } from "@flowstore/core/files/load";
import type { Spec } from "@flowstore/core/schema/v0";
import type { TestingArtifacts } from "@flowstore/core/files/types";

interface CacheEntry {
  spec: Spec;
  testingArtifacts: TestingArtifacts;
}

// Bounded LRU keyed by resolved commit SHA. Specs are a few KB; a session
// rarely diffs more than a handful of commits, so this stays tiny.
const MAX_ENTRIES = 30;
const cache = new Map<string, CacheEntry>();

export async function specAtRef(
  loc: GitHubLocation,
  commitish: string,
): Promise<{ spec: Spec; testingArtifacts: TestingArtifacts; sha: string }> {
  const { commitSha, treeSha } = await resolveCommit(loc, commitish);

  const hit = cache.get(commitSha);
  if (hit) {
    touch(commitSha, hit);
    return { ...hit, sha: commitSha };
  }

  const { files } = await readRepoAtTree(loc, commitSha, treeSha);
  const { spec, testingArtifacts } = loadProject(files);
  if (!spec) throw new Error(`${commitish} has no valid flowstore project`);
  const entry: CacheEntry = { spec, testingArtifacts };
  touch(commitSha, entry);
  return { ...entry, sha: commitSha };
}

// Re-insert to move to the most-recent end (Map preserves insertion order);
// evict the oldest once over capacity.
function touch(sha: string, entry: CacheEntry): void {
  cache.delete(sha);
  cache.set(sha, entry);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}
