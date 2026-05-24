import {
  writeFileMapToRepo,
  makeGitHubClient,
  ConflictError,
  type GitHubLocation,
} from "@ux4/core/files/github";
import { commentPath } from "@ux4/core/files";
import type { Comment } from "@ux4/core/schema/files/comment";

const MAX_ATTEMPTS = 4;

// Posts a single comment file to the GitHub-backed project. UUID-keyed
// paths cannot collide content-wise, so any "ref not fast-forward" rejection
// is always safely retriable: re-read HEAD, build a new commit on top,
// retry. Bursts of rapid posts (and GitHub's mildly-eventually-consistent
// Git Data API reads) can both trip this on what should be linear history,
// so the retry runs automatically — the user shouldn't have to refresh.
//
// `resolve = rewrite the same UUID file with resolved flipped` is also
// content-safe (last write wins for that one byte of state), so the same
// retry loop applies.
export async function postComment(
  loc: GitHubLocation,
  comment: Comment,
  message: string,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await writeFileMapToRepo(
        loc,
        { [commentPath(comment)]: JSON.stringify(comment, null, 2) + "\n" },
        message,
      );
      return res.commitSha;
    } catch (e) {
      lastErr = e;
      if (!isFastForwardConflict(e)) throw e;
      // Tiny backoff so GitHub's read replicas catch up before the retry's
      // getRef — fixes the most common cause of repeated failures.
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("postComment failed");
}

function isFastForwardConflict(e: unknown): boolean {
  if (e instanceof ConflictError) return true;
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  // GitHub returns 422 with "Update is not a fast forward" on non-FF
  // updateRef; the Octokit wrapper bubbles that string up verbatim.
  return msg.includes("not a fast forward") || msg.includes("not a fast-forward");
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
