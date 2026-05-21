import { useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { useSpecStore } from "@/lib/store/spec";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import {
  makeGitHubClient,
  readRepoToFileMap,
  type Octokit,
} from "@ux4/core/files/github";
import { loadProject } from "@ux4/core/files";

interface GitHubOpenModalProps {
  onClose: () => void;
  onOpenSettings: () => void;
}

interface RepoSummary {
  full_name: string;
  owner: string;
  repo: string;
  default_branch: string;
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
    try {
      const { files, commitSha } = await readRepoToFileMap({
        client,
        owner: repo.owner,
        repo: repo.repo,
        ref: selectedBranch,
      });
      const { spec, errors } = loadProject(files);
      if (!spec) {
        const msg =
          errors.length > 0
            ? errors
                .map((e) => `${e.path ? e.path + ": " : ""}${e.message}`)
                .join("; ")
            : "No UX4 project found in this repo.";
        setError(msg);
        return;
      }
      setSpec(spec);
      setLoaded({ owner: repo.owner, repo: repo.repo, ref: selectedBranch }, commitSha);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open project");
    } finally {
      setOpeningProject(false);
    }
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
              onChange={(e) => setSelectedRepoIdx(Number(e.target.value))}
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
              onChange={(e) => setSelectedBranch(e.target.value)}
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
          <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-800">
            {error}
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
        <button
          onClick={openProject}
          disabled={selectedRepoIdx < 0 || !selectedBranch || openingProject}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {openingProject ? "Opening…" : "Open"}
        </button>
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
