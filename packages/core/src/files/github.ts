import { Octokit } from "@octokit/rest";
import type { FileMap } from "./types";

export { Octokit };

export function makeGitHubClient(token: string): Octokit {
  return new Octokit({ auth: token });
}

export interface ConnectionInfo {
  login: string;
  name?: string;
}

export async function testConnection(client: Octokit): Promise<ConnectionInfo> {
  const res = await client.rest.users.getAuthenticated();
  return { login: res.data.login, name: res.data.name ?? undefined };
}

export interface CreatedRepo {
  owner: string;
  repo: string;
  defaultBranch: string;
}

// Creates a new repository under the authenticated user with no initial
// commit (auto_init: false) so writeFileMapToRepo's empty-repo path lays
// down the spec as the first commit. Returns the actual owner/name GitHub
// assigned (the name may be normalized) and the repo's default branch — write
// to that, not a hardcoded "main", since the account's default may differ.
export async function createRepo(
  client: Octokit,
  opts: { name: string; private: boolean; description?: string },
): Promise<CreatedRepo> {
  // auto_init: true races — GitHub finalizes its "Initial commit" README
  // asynchronously and can force-push the ref *after* our first write,
  // surfacing later as a phantom "Someone else saved changes" on the
  // user's next save. Even polling getReadme isn't enough (the README is
  // visible before the ref is finalized). We avoid the race by
  // initializing the git database ourselves via the Contents API, which
  // is synchronous and creates a real, stable initial commit.
  const res = await client.rest.repos.createForAuthenticatedUser({
    name: opts.name,
    private: opts.private,
    auto_init: false,
    description: opts.description,
  });
  const owner = res.data.owner.login;
  const repo = res.data.name;
  const defaultBranch = res.data.default_branch ?? "main";

  // Push a placeholder README to create the initial commit. The first
  // writeFileMapToRepo call overlays the real flowstore README (and
  // everything else) on top via base_tree, so the placeholder content
  // doesn't survive the user's first save.
  await client.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: "README.md",
    message: "Initialize repository",
    content: btoa(`# ${repo}\n`),
    branch: defaultBranch,
  });

  return { owner, repo, defaultBranch };
}

// Best-effort topic stamp so the project shows up in a
// `search/repositories?q=topic:flowstore` dashboard query. Never throws —
// a topic failure must not fail project creation.
export async function tagRepoTopic(
  client: Octokit,
  owner: string,
  repo: string,
  topic = "flowstore",
): Promise<void> {
  try {
    await client.rest.repos.replaceAllTopics({ owner, repo, names: [topic] });
  } catch {
    // ignore — cosmetic
  }
}

// User-facing role tiers — `read` maps to GitHub's `pull` permission, and
// `write` maps to `push`. Higher tiers (maintain/admin/triage) exist on the
// API but aren't exposed in the Share UI; we display them read-only when
// they appear on existing collaborators.
export type CollaboratorRole = "read" | "write";

export interface Collaborator {
  login: string;
  avatarUrl?: string;
  // Raw permission name from GitHub so the UI can label admins/owners/etc.
  // distinctly from the two roles users can grant.
  permission: string;
}

export interface PendingInvitation {
  id: number;
  invitee: string;
  permission: string;
}

function rolePermission(role: CollaboratorRole): "pull" | "push" {
  return role === "write" ? "push" : "pull";
}

export async function listCollaborators(
  client: Octokit,
  owner: string,
  repo: string,
): Promise<Collaborator[]> {
  const res = await client.rest.repos.listCollaborators({ owner, repo, per_page: 100 });
  return res.data.map((c) => ({
    login: c.login,
    avatarUrl: c.avatar_url,
    permission: c.role_name ?? "read",
  }));
}

export async function listInvitations(
  client: Octokit,
  owner: string,
  repo: string,
): Promise<PendingInvitation[]> {
  const res = await client.rest.repos.listInvitations({ owner, repo, per_page: 100 });
  return res.data.map((inv) => ({
    id: inv.id,
    invitee: inv.invitee?.login ?? "",
    permission: inv.permissions ?? "read",
  }));
}

// Returns true if the call created a new invitation (user wasn't already a
// collaborator), false if it just updated an existing membership.
export async function addCollaborator(
  client: Octokit,
  owner: string,
  repo: string,
  username: string,
  role: CollaboratorRole,
): Promise<boolean> {
  const res = await client.rest.repos.addCollaborator({
    owner,
    repo,
    username,
    permission: rolePermission(role),
  });
  // GitHub returns 201 + invitation body for new invites, 204 (no body) when
  // the user is already a collaborator (permission updated).
  return res.status === 201;
}

export async function removeCollaborator(
  client: Octokit,
  owner: string,
  repo: string,
  username: string,
): Promise<void> {
  await client.rest.repos.removeCollaborator({ owner, repo, username });
}

export async function cancelInvitation(
  client: Octokit,
  owner: string,
  repo: string,
  invitationId: number,
): Promise<void> {
  await client.rest.repos.deleteInvitation({ owner, repo, invitation_id: invitationId });
}

// True when repos.createForAuthenticatedUser failed because the name is
// already taken (422 with an "already exists" validation error). The caller
// retries with a suffixed slug rather than surfacing a raw error — the repo
// name is plumbing the user didn't pick.
export function isRepoNameTaken(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as {
    status?: unknown;
    message?: string;
    response?: { data?: { errors?: Array<{ message?: string }> } };
  };
  if (err.status !== 422) return false;
  const text =
    (err.response?.data?.errors ?? []).map((x) => x.message ?? "").join(" ") +
    " " +
    (err.message ?? "");
  return /already exists/i.test(text);
}

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
// By default only fetches blobs with flowstore-relevant extensions (.json, .csv,
// .md, .txt, .yaml/.yml) — supplementary content (PDFs, xlsx, etc.) under
// the FILE-MODEL.md "Non-loaded files" convention is skipped to save
// bandwidth and API quota. Callers can override with includePath.
export async function readRepoToFileMap(
  loc: GitHubLocation,
  opts: ReadOptions = {},
): Promise<ReadResult> {
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
  return readRepoAtTree(loc, commitSha, commit.data.tree.sha, opts);
}

// Resolve a commit-ish — a branch name, tag, or commit SHA (abbreviated SHAs
// from git_log work too) — to its concrete commit + tree SHAs via the commits
// API. One cheap request. Callers that cache immutable trees resolve first,
// then skip the tree+blob read on a cache hit.
export async function resolveCommit(
  loc: GitHubLocation,
  commitish: string,
): Promise<{ commitSha: string; treeSha: string }> {
  const commit = await loc.client.rest.repos.getCommit({
    owner: loc.owner,
    repo: loc.repo,
    ref: commitish,
  });
  return { commitSha: commit.data.sha, treeSha: commit.data.commit.tree.sha };
}

// Fetch every included blob under a known tree into an in-memory FileMap.
// Trees are immutable, so results are safe to cache by commit/tree SHA.
export async function readRepoAtTree(
  loc: GitHubLocation,
  commitSha: string,
  treeSha: string,
  opts: ReadOptions = {},
): Promise<ReadResult> {
  const include = opts.includePath ?? defaultIncludePath;
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
    if (!isNotFound(e) && !isEmptyRepo(e)) throw e;
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
    // When the caller opted out of the conflict check (no expectedCommitSha
    // — e.g., pendingForceSave on a brand-new repo, or a deliberate
    // "Overwrite their changes"), also bypass the fast-forward check on
    // updateRef. Without this, an integration that advances HEAD between
    // our getRef and updateRef can still 422 us within a single call,
    // making the bypass meaningless.
    await loc.client.rest.git.updateRef({
      owner: loc.owner,
      repo: loc.repo,
      ref: `heads/${loc.ref}`,
      sha: newCommit.data.sha,
      force: opts.expectedCommitSha === undefined,
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

// A repo created with auto_init:false has no commits and no default ref yet;
// getRef on it returns 409 "Git Repository is empty" rather than a 404. Both
// 404 (ref absent) and 409 (repo empty) mean "no base commit — create the
// first one."
function isEmptyRepo(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    (e as { status: unknown }).status === 409
  );
}

// True when a write was refused — either role-based (the user is read-only
// on this repo) or token-scope (their PAT lacks Contents:write). The caller
// reacts by offering "Save a copy" rather than surfacing a raw 403.
export function isForbidden(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    (e as { status: unknown }).status === 403
  );
}

// Flatten an Octokit error into searchable text: the top-level message plus
// any `response.data.message` and per-field `errors[].message` GitHub returns.
function errorText(e: unknown): string {
  if (typeof e !== "object" || e === null) return "";
  const err = e as {
    message?: unknown;
    response?: { data?: { message?: unknown; errors?: Array<{ message?: unknown }> } };
  };
  const parts: string[] = [];
  if (typeof err.message === "string") parts.push(err.message);
  const data = err.response?.data;
  if (data) {
    if (typeof data.message === "string") parts.push(data.message);
    if (Array.isArray(data.errors)) {
      for (const x of data.errors) if (x && typeof x.message === "string") parts.push(x.message);
    }
  }
  return parts.join(" ");
}

// True when a direct ref update was rejected by *branch protection* — a
// required pull request, required reviews/status checks, or an update-via-API
// restriction. GitHub returns 422 with a message naming the protection. The
// write itself was permitted (the user has push access), so the caller can
// offer both "Save to a new branch" (then open a PR) and "Save a copy"
// — unlike isForbidden, a flat read-only 403 where creating a branch would
// fail too.
export function isProtectedBranch(e: unknown): boolean {
  if (typeof e !== "object" || e === null || !("status" in e)) return false;
  if ((e as { status: unknown }).status !== 422) return false;
  const msg = errorText(e).toLowerCase();
  return (
    msg.includes("protected branch") ||
    msg.includes("branch protection") ||
    msg.includes("required status check") ||
    msg.includes("approving review") ||
    msg.includes("pull request")
  );
}
