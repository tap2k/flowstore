import {
  makeGitHubClient,
  type GitHubLocation,
} from "@flowstore/core/files/github";
import { commentPath } from "@flowstore/core/files";
import type { Comment } from "@flowstore/core/schema/files/comment";

// Posts a single comment file via GitHub's Contents API (`PUT
// /repos/{owner}/{repo}/contents/{path}`), not the lower-level Git Data
// API used for whole-spec saves. The Contents API serializes concurrent
// writes server-side: no read-then-update-ref dance, no stale-replica
// race, no "not a fast forward" 422s on rapid sequential posts.
//
// `mode: "create"` skips the existence probe — caller asserts the file
// doesn't exist yet (true for newly-uuid'd comments). `mode: "update"`
// fetches the current blob sha so the PUT can replace the file
// (resolve/reopen).
export async function postComment(
  loc: GitHubLocation,
  comment: Comment,
  message: string,
  mode: "create" | "update" = "create",
): Promise<string> {
  const path = commentPath(comment);
  const body = JSON.stringify(comment, null, 2) + "\n";
  const existingSha = mode === "update" ? await tryGetFileSha(loc, path) : undefined;
  const res = await loc.client.rest.repos.createOrUpdateFileContents({
    owner: loc.owner,
    repo: loc.repo,
    branch: loc.ref,
    path,
    message,
    content: toBase64(body),
    ...(existingSha ? { sha: existingSha } : {}),
  });
  const commitSha = res.data.commit.sha;
  if (!commitSha) throw new Error("Contents API returned no commit SHA");
  return commitSha;
}

async function tryGetFileSha(loc: GitHubLocation, path: string): Promise<string | undefined> {
  try {
    const res = await loc.client.rest.repos.getContent({
      owner: loc.owner,
      repo: loc.repo,
      ref: loc.ref,
      path,
    });
    const data = res.data;
    if (Array.isArray(data)) return undefined;
    return "sha" in data ? data.sha : undefined;
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "status" in e && (e as { status: unknown }).status === 404) {
      return undefined;
    }
    throw e;
  }
}

function toBase64(text: string): string {
  if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(text)));
  return Buffer.from(text, "utf8").toString("base64");
}

// Convenience for callers that just have a PAT + repo coords.
export function locationFromParts(
  pat: string,
  owner: string,
  repo: string,
  ref: string,
): GitHubLocation {
  return { client: makeGitHubClient(pat), owner, repo, ref };
}
