import { useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { useSpecStore } from "@/lib/store/spec";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import {
  makeGitHubClient,
  readRepoToFileMap,
  type Octokit,
} from "@flowstore/core/files/github";
import { loadProject } from "@flowstore/core/files";
import { useCommentsStore } from "@/lib/store/comments";
import { scaffoldNewProject } from "@flowstore/core/files/scaffold";

interface GitHubOpenModalProps {
  onClose: () => void;
  onOpenSettings: () => void;
}

interface RepoSummary {
  full_name: string;
  owner: string;
  repo: string;
  default_branch: string;
  // From the list response's permissions.push — false for read-only
  // collaborator / org-read access. Propagates into githubProject.canWrite
  // so the editor knows up front that Save needs to route to "Save a copy."
  canWrite: boolean;
}

interface BranchSummary {
  name: string;
}

export function GitHubOpenModal({ onClose, onOpenSettings }: GitHubOpenModalProps) {
  const pat = useSettingsStore((s) => s.githubPat);
  const existingSpec = useSpecStore((s) => s.spec);
  const setSpec = useSpecStore((s) => s.setSpec);
  const setLoaded = useGithubProjectStore((s) => s.setLoaded);

  const [client] = useState<Octokit | null>(() => (pat ? makeGitHubClient(pat) : null));
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [selectedRepoIdx, setSelectedRepoIdx] = useState<number>(-1);
  const [branches, setBranches] = useState<BranchSummary[] | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [openingProject, setOpeningProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When set, the selected repo+branch has no flowstore project; offer to initialize.
  // commitSha is null when the ref has no commits at all (truly fresh repo).
  const [initOffer, setInitOffer] = useState<
    | { repo: RepoSummary; branch: string; commitSha: string | null }
    | null
  >(null);

  useEffect(() => {
    if (!client) return;
    setLoadingRepos(true);
    setError(null);
    client.rest.repos
      .listForAuthenticatedUser({ sort: "updated", per_page: 100 })
      .then((res) => {
        const summaries: RepoSummary[] = res.data.map((r) => ({
          full_name: r.full_name,
          owner: r.owner.login,
          repo: r.name,
          default_branch: r.default_branch,
          canWrite: r.permissions?.push ?? false,
        }));
        setRepos(summaries);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to fetch repos"))
      .finally(() => setLoadingRepos(false));
  }, [client]);

  useEffect(() => {
    if (!client || selectedRepoIdx < 0 || !repos) {
      setBranches(null);
      setSelectedBranch("");
      return;
    }
    const repo = repos[selectedRepoIdx];
    setLoadingBranches(true);
    setSelectedBranch(repo.default_branch);
    client.rest.repos
      .listBranches({ owner: repo.owner, repo: repo.repo, per_page: 100 })
      .then((res) => setBranches(res.data.map((b) => ({ name: b.name }))))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to fetch branches"))
      .finally(() => setLoadingBranches(false));
  }, [client, selectedRepoIdx, repos]);

  async function openProject() {
    if (!client || selectedRepoIdx < 0 || !repos || !selectedBranch) return;
    if (existingSpec && !window.confirm("Replace the current spec?")) return;
    const repo = repos[selectedRepoIdx];
    setOpeningProject(true);
    setError(null);
    setInitOffer(null);
    try {
      let files: Record<string, string> | null = null;
      let commitSha: string | null = null;
      try {
        const read = await readRepoToFileMap({
          client,
          owner: repo.owner,
          repo: repo.repo,
          ref: selectedBranch,
        });
        files = read.files;
        commitSha = read.commitSha;
      } catch (e: unknown) {
        // Empty repo: branch ref doesn't exist yet. Offer to initialize.
        if (typeof e === "object" && e !== null && "status" in e && (e as { status: unknown }).status === 404) {
          setInitOffer({ repo, branch: selectedBranch, commitSha: null });
          return;
        }
        throw e;
      }
      const { spec, comments, errors } = loadProject(files);
      if (!spec) {
        // Repo has commits (e.g., README only) but no flowstore project — offer init.
        // If load errors look structural (malformed flowstore files), surface them so
        // the user doesn't accidentally overwrite something they were editing.
        const isMissingAgent = errors.some((e) => e.message.includes("missing agent.json"));
        if (isMissingAgent && errors.length === 1) {
          setInitOffer({ repo, branch: selectedBranch, commitSha });
          return;
        }
        const msg =
          errors.length > 0
            ? errors
                .map((e) => `${e.path ? e.path + ": " : ""}${e.message}`)
                .join("; ")
            : "No flowstore project found in this repo.";
        setError(msg);
        return;
      }
      setSpec(spec);
      setLoaded(
        { owner: repo.owner, repo: repo.repo, ref: selectedBranch },
        commitSha,
        repo.canWrite,
      );
      useCommentsStore.getState().setAll(comments);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open project");
    } finally {
      setOpeningProject(false);
    }
  }

  function initializeProject() {
    if (!initOffer) return;
    const { repo, branch, commitSha } = initOffer;
    const scaffold = scaffoldNewProject({ name: repo.repo });
    setSpec(scaffold);
    setLoaded({ owner: repo.owner, repo: repo.repo, ref: branch }, commitSha);
    useCommentsStore.getState().setAll([]);
    onClose();
  }

  if (!pat) {
    return (
      <Shell title="Open GitHub project" onClose={onClose}>
        <p className="text-sm text-zinc-700">
          A GitHub PAT is required to open a project. Add one in Settings.
        </p>
        <div className="flex justify-end gap-2 pt-3">
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            onClick={onOpenSettings}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
          >
            Open Settings
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Open GitHub project" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-zinc-700">Repository</label>
          {loadingRepos ? (
            <div className="mt-1 text-xs text-zinc-500">Loading…</div>
          ) : (
            <select
              value={selectedRepoIdx}
              onChange={(e) => {
                setSelectedRepoIdx(Number(e.target.value));
                setInitOffer(null);
                setError(null);
              }}
              className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            >
              <option value={-1}>— select —</option>
              {(repos ?? []).map((r, i) => (
                <option key={r.full_name} value={i}>
                  {r.full_name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-700">Branch</label>
          {loadingBranches ? (
            <div className="mt-1 text-xs text-zinc-500">Loading…</div>
          ) : (
            <select
              value={selectedBranch}
              onChange={(e) => {
                setSelectedBranch(e.target.value);
                setInitOffer(null);
                setError(null);
              }}
              disabled={!branches || branches.length === 0}
              className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 disabled:opacity-50"
            >
              {(branches ?? []).map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
            {error}
          </div>
        )}
        {initOffer && (
          <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 space-y-1">
            <div>
              <span className="font-mono">{initOffer.repo.full_name}@{initOffer.branch}</span>{" "}
              has no flowstore project{initOffer.commitSha === null ? " (and no commits yet)" : ""}.
            </div>
            <div>
              Initialize a starter project? The editor loads a scaffold spec; nothing is written
              to GitHub until you click Save.
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-3">
        <button
          onClick={onClose}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Cancel
        </button>
        {initOffer ? (
          <button
            onClick={initializeProject}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
          >
            Initialize project
          </button>
        ) : (
          <button
            onClick={openProject}
            disabled={selectedRepoIdx < 0 || !selectedBranch || openingProject}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {openingProject ? "Opening…" : "Open"}
          </button>
        )}
      </div>
    </Shell>
  );
}

function Shell({
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
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-xs text-zinc-500 hover:text-zinc-900"
          >
            close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
