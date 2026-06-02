// Read-only git/GitHub tools for the chat co-author.
//
// These are the "pull" half of the design: rather than injecting git history /
// diffs into every chat turn (the context is already heavy with the full
// spec), the model fetches them on demand only when a request needs them.
// Diffs are returned as semantic, id-resolved spec diffs (see
// @flowstore/core/spec/diff) — never raw `git diff` text.
//
// All tools here are strictly read-only. Writes to the shared remote (commit,
// branch, force-push) stay in the user's hands via the Save UI and its
// optimistic-concurrency checks — an autonomous LLM tool-loop is exactly where
// we don't want those firing.

import { useSpecStore } from "@/lib/store/spec";
import { useSettingsStore } from "@/lib/store/settings";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import { makeGitHubClient, type GitHubLocation } from "@flowstore/core/files/github";
import { diffSpecs, renderSpecDiff } from "@flowstore/core/spec/diff";
import { specAtRef } from "@/lib/github/specAtRef";
import type { Tool, ToolResult } from "./tools";

// Build a GitHubLocation for the open project + PAT, or return a ToolResult
// error explaining what's missing. The diff tools read at arbitrary commit-ish
// refs separately (readSpecAt); this just carries the repo + the open branch.
function resolveLocation(): GitHubLocation | ToolResult {
  const loc = useGithubProjectStore.getState().location;
  if (!loc) return { ok: false, error: "no GitHub project is open — open a repo first" };
  const pat = useSettingsStore.getState().githubPat;
  if (!pat) return { ok: false, error: "no GitHub token configured — add a PAT in Settings" };
  return { client: makeGitHubClient(pat), owner: loc.owner, repo: loc.repo, ref: loc.ref };
}

function isErr(x: GitHubLocation | ToolResult): x is ToolResult {
  return "ok" in x;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const gitDiffUnsavedTool: Tool = {
  definition: {
    name: "git_diff_unsaved",
    description:
      "Show the semantic diff between the saved spec on the current branch and the in-memory working copy (the user's unsaved edits). Use when asked what changed, what's unsaved, or to review before saving. Returns an id-resolved spec diff, not raw file text.",
    parameters: { type: "object", properties: {} },
  },
  impl: async () => {
    const working = useSpecStore.getState().spec;
    if (!working) return { ok: false, error: "no spec is loaded in the editor" };
    const loc = resolveLocation();
    if (isErr(loc)) return loc;
    try {
      // Diff against the commit the working copy descends from
      // (lastKnownCommitSha), NOT the live branch tip — otherwise a concurrent
      // remote commit would be misattributed as the user's unsaved edits.
      // Falls back to the branch ref for a fresh repo with no commit yet.
      const baseRef = useGithubProjectStore.getState().lastKnownCommitSha ?? loc.ref;
      const base = await specAtRef(loc, baseRef);
      const diff = diffSpecs(base.spec, working, { baseSha: base.sha });
      return { ok: true, data: { diff: renderSpecDiff(diff), changed: !diff.empty } };
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
  },
};

const gitDiffRefsTool: Tool = {
  definition: {
    name: "git_diff_refs",
    description:
      "Show the semantic spec diff between two points in history. `base` and `head` are each a branch name, tag, or commit SHA (abbreviated SHAs from git_log work). Use to compare branches or commits — e.g. a commit against its parent. Returns an id-resolved spec diff, not raw file text.",
    parameters: {
      type: "object",
      properties: {
        base: { type: "string", description: "The 'before' point: branch, tag, or commit SHA." },
        head: { type: "string", description: "The 'after' point: branch, tag, or commit SHA." },
      },
      required: ["base", "head"],
    },
  },
  impl: async (args) => {
    const { base, head } = args as { base: string; head: string };
    const loc = resolveLocation();
    if (isErr(loc)) return loc;
    try {
      const [b, h] = await Promise.all([specAtRef(loc, base), specAtRef(loc, head)]);
      const diff = diffSpecs(b.spec, h.spec, { baseSha: b.sha, headSha: h.sha });
      return { ok: true, data: { diff: renderSpecDiff(diff), changed: !diff.empty } };
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
  },
};

const gitLogTool: Tool = {
  definition: {
    name: "git_log",
    description:
      "List recent commits on the current branch (most recent first). Use for revision history — what changed, when, by whom. Each row includes its parent SHA, so to see a single commit's changes call git_diff_refs(base: parent, head: sha). Returns compact rows; not diffs.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max commits to return (default 10, max 30)." },
      },
    },
  },
  impl: async (args) => {
    const { limit } = (args ?? {}) as { limit?: number };
    const loc = resolveLocation();
    if (isErr(loc)) return loc;
    const per = Math.max(1, Math.min(30, limit ?? 10));
    try {
      const res = await loc.client.rest.repos.listCommits({
        owner: loc.owner,
        repo: loc.repo,
        sha: loc.ref,
        per_page: per,
      });
      const commits = res.data.map((c) => ({
        sha: c.sha.slice(0, 7),
        parent: c.parents?.[0]?.sha?.slice(0, 7) ?? null,
        message: (c.commit.message ?? "").split("\n")[0],
        author: c.commit.author?.name ?? c.author?.login ?? "unknown",
        date: c.commit.author?.date ?? null,
      }));
      return { ok: true, data: { branch: loc.ref, commits } };
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
  },
};

const gitListBranchesTool: Tool = {
  definition: {
    name: "git_list_branches",
    description:
      "List branches in the current repo, flagging the one the project is open on. Use before comparing branches with git_diff_refs.",
    parameters: { type: "object", properties: {} },
  },
  impl: async () => {
    const loc = resolveLocation();
    if (isErr(loc)) return loc;
    try {
      const res = await loc.client.rest.repos.listBranches({
        owner: loc.owner,
        repo: loc.repo,
        per_page: 100,
      });
      const branches = res.data.map((b) => ({ name: b.name, current: b.name === loc.ref }));
      return { ok: true, data: { current: loc.ref, branches } };
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
  },
};

export const gitTools: Tool[] = [
  gitDiffUnsavedTool,
  gitDiffRefsTool,
  gitLogTool,
  gitListBranchesTool,
];
