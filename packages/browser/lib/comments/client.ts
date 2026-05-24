import {
  writeFileMapToRepo,
  makeGitHubClient,
  type GitHubLocation,
} from "@ux4/core/files/github";
import { commentPath } from "@ux4/core/files";
import type { Comment } from "@ux4/core/schema/files/comment";

// Posts a single new comment file to the GitHub-backed project. UUID-keyed
// path means two writers never collide. Returns the new HEAD commit SHA so
// the caller can advance its concurrency cursor.
export async function postComment(
  loc: GitHubLocation,
  comment: Comment,
  message: string,
): Promise<string> {
  const res = await writeFileMapToRepo(
    loc,
    { [commentPath(comment)]: JSON.stringify(comment, null, 2) + "\n" },
    message,
  );
  return res.commitSha;
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
