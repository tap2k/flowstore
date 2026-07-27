import { useEffect, useState } from "react";
import type { Octokit } from "@flowstore/core/files/github";

// Shared chrome for the GitHub modals — editor (GitHubOpenModal,
// SaveToNewRepoModal) and compare (GitHubStudyModals) render the same URL
// parsing, repo listing, slugging, and modal shell. One home so PAT/list/URL
// behavior can't drift between the two surfaces.

// Projects stamp this topic at create time so they surface in repo pickers
// without probing each repo for agent.json.
export const FLOWSTORE_TOPIC = "flowstore";

export interface RepoSummary {
  full_name: string;
  owner: string;
  repo: string;
  default_branch: string;
  // From the list response's permissions — false for read-only access.
  canWrite: boolean;
  canAdmin: boolean;
  topics: string[];
}

// Accepts: https://github.com/owner/repo[/tree/branch][/...] or owner/repo
// shorthand. Returns null for anything that doesn't resolve.
export function parseGitHubUrl(
  input: string,
): { owner: string; repo: string; branch?: string } | null {
  try {
    const trimmed = input.trim();
    let pathname: string;
    try {
      const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      if (url.hostname !== "github.com") return null;
      pathname = url.pathname;
    } catch {
      pathname = `/${trimmed}`;
    }
    const parts = pathname.replace(/^\//, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo, maybeTree, ...branchParts] = parts;
    const branch =
      maybeTree === "tree" && branchParts.length > 0 ? branchParts.join("/") : undefined;
    return { owner, repo: repo.replace(/\.git$/, ""), branch };
  } catch {
    return null;
  }
}

// GitHub repo names allow [A-Za-z0-9._-]; everything else collapses to a dash.
export function toRepoSlug(name: string, fallback: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

// One in-flight/settled listing per PAT: the open→save flow (and every modal
// re-open) reuses the result instead of re-fetching ~100 repos each mount.
// Keyed by cacheKey (the PAT) since each modal builds its own client.
let repoListCache: { key: string; promise: Promise<RepoSummary[]> } | null = null;

export function useRepoList(client: Octokit | null, cacheKey: string) {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    if (!repoListCache || repoListCache.key !== cacheKey) {
      repoListCache = {
        key: cacheKey,
        promise: client.rest.repos
          .listForAuthenticatedUser({ sort: "updated", per_page: 100, type: "all" })
          .then((res) =>
            res.data.map((r) => ({
              full_name: r.full_name,
              owner: r.owner.login,
              repo: r.name,
              default_branch: r.default_branch,
              canWrite: r.permissions?.push ?? false,
              canAdmin: r.permissions?.admin ?? false,
              topics: r.topics ?? [],
            })),
          ),
      };
      // A failed listing must not poison the cache for the next mount.
      repoListCache.promise.catch(() => {
        if (repoListCache?.key === cacheKey) repoListCache = null;
      });
    }
    let cancelled = false;
    setLoading(true);
    repoListCache.promise
      .then((list) => {
        if (!cancelled) setRepos(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to fetch repos");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, cacheKey]);
  return { repos, loading, error };
}

// The modal shell both surfaces' GitHub dialogs render.
export function Shell({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-zinc-900 mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}
