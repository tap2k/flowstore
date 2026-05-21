import type { Octokit } from "@octokit/rest";
import type { FileMap } from "./types";

export interface GitHubLocation {
  client: Octokit;
  owner: string;
  repo: string;
  ref: string;
}

export interface ReadResult {
  files: FileMap;
  commitSha: string;
  treeSha: string;
}

export interface WriteResult {
  commitSha: string;
  treeSha: string;
}

export interface ReadOptions {
  includePath?: (path: string) => boolean;
}

export interface WriteOptions {
  expectedCommitSha?: string;
}

// Reads every file at HEAD of the named branch into an in-memory FileMap.
// By default only fetches blobs with UX4-relevant extensions (.json, .csv,
// .md, .txt, .yaml/.yml) — supplementary content (PDFs, xlsx, etc.) under
// the FILE-MODEL.md "Non-loaded files" convention is skipped to save
// bandwidth and API quota. Callers can override with includePath.
export async function readRepoToFileMap(
  loc: GitHubLocation,
  opts: ReadOptions = {},
): Promise<ReadResult> {
  const include = opts.includePath ?? defaultIncludePath;
  const ref = await loc.client.rest.git.getRef({
    owner: loc.owner,
    repo: loc.repo,
    ref: `heads/${loc.ref}`,
  });
  const commitSha = ref.data.object.sha;
  const commit = await loc.client.rest.git.getCommit({
    owner: loc.owner,
    repo: loc.repo,
    commit_sha: commitSha,
  });
  const treeSha = commit.data.tree.sha;
  const tree = await loc.client.rest.git.getTree({
    owner: loc.owner,
    repo: loc.repo,
    tree_sha: treeSha,
    recursive: "true",
  });

  const blobs = tree.data.tree.filter(
    (e) => e.type === "blob" && !!e.path && !!e.sha && include(e.path),
  );
  const entries = await Promise.all(
    blobs.map(async (e) => {
      const blob = await loc.client.rest.git.getBlob({
        owner: loc.owner,
        repo: loc.repo,
        file_sha: e.sha!,
      });
      return [e.path!, decodeBlob(blob.data.content, blob.data.encoding)] as const;
    }),
  );
  const files: FileMap = {};
  for (const [path, content] of entries) files[path] = content;

  return { files, commitSha, treeSha };
}

// Atomic multi-file commit via the Git Data API. base_tree inherits any
// untracked supplementary files (docs/, assets/, etc.) so they aren't dropped.
// If expectedCommitSha is passed and the ref has advanced past it, throws
// ConflictError for the editor to surface as "this file changed since you
// opened it." Empty repos (no ref yet) are handled — first write creates the
// initial commit.
export async function writeFileMapToRepo(
  loc: GitHubLocation,
  files: FileMap,
  message: string,
  opts: WriteOptions = {},
): Promise<WriteResult> {
  let baseCommitSha: string | undefined;
  let baseTreeSha: string | undefined;
  try {
    const ref = await loc.client.rest.git.getRef({
      owner: loc.owner,
      repo: loc.repo,
      ref: `heads/${loc.ref}`,
    });
    baseCommitSha = ref.data.object.sha;
    if (opts.expectedCommitSha && opts.expectedCommitSha !== baseCommitSha) {
      throw new ConflictError(opts.expectedCommitSha, baseCommitSha);
    }
    const commit = await loc.client.rest.git.getCommit({
      owner: loc.owner,
      repo: loc.repo,
      commit_sha: baseCommitSha,
    });
    baseTreeSha = commit.data.tree.sha;
  } catch (e: unknown) {
    if (!isNotFound(e)) throw e;
  }

  const treeEntries = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const blob = await loc.client.rest.git.createBlob({
        owner: loc.owner,
        repo: loc.repo,
        content: encodeBlob(content),
        encoding: "base64",
      });
      return {
        path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.data.sha,
      };
    }),
  );

  const newTree = await loc.client.rest.git.createTree({
    owner: loc.owner,
    repo: loc.repo,
    base_tree: baseTreeSha,
    tree: treeEntries,
  });

  const newCommit = await loc.client.rest.git.createCommit({
    owner: loc.owner,
    repo: loc.repo,
    message,
    tree: newTree.data.sha,
    parents: baseCommitSha ? [baseCommitSha] : [],
  });

  if (baseCommitSha) {
    await loc.client.rest.git.updateRef({
      owner: loc.owner,
      repo: loc.repo,
      ref: `heads/${loc.ref}`,
      sha: newCommit.data.sha,
    });
  } else {
    await loc.client.rest.git.createRef({
      owner: loc.owner,
      repo: loc.repo,
      ref: `refs/heads/${loc.ref}`,
      sha: newCommit.data.sha,
    });
  }

  return { commitSha: newCommit.data.sha, treeSha: newTree.data.sha };
}

export class ConflictError extends Error {
  constructor(
    public expected: string,
    public actual?: string,
  ) {
    super(`ref has advanced (expected ${expected}, got ${actual ?? "<none>"})`);
    this.name = "ConflictError";
  }
}

function defaultIncludePath(path: string): boolean {
  return /\.(json|csv|md|txt|ya?ml)$/i.test(path);
}

function decodeBlob(content: string, encoding: string): string {
  if (encoding !== "base64") return content;
  if (typeof Buffer !== "undefined") return Buffer.from(content, "base64").toString("utf8");
  const bin = atob(content.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf8").decode(bytes);
}

function encodeBlob(content: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(content, "utf8").toString("base64");
  const bytes = new TextEncoder().encode(content);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function isNotFound(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    (e as { status: unknown }).status === 404
  );
}
