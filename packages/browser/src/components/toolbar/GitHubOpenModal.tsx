import { useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { useSpecStore } from "@/lib/store/spec";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import {
  makeGitHubClient,
  readRepoToFileMap,
  Octokit,
} from "@flowstore/core/files/github";
import { loadProject } from "@flowstore/core/files";
import { loadSpec } from "@/lib/store/loadSpec";
import { markProjectBaseline } from "@/lib/store/dirty";
import { scaffoldNewProject } from "@flowstore/core/files/scaffold";
import {
  FLOWSTORE_TOPIC,
  Shell,
  parseGitHubUrl,
  useRepoList,
  type RepoSummary,
} from "@/lib/githubUi";

interface GitHubOpenModalProps {
  onClose: () => void;
  onOpenSettings: () => void;
}

interface BranchSummary {
  name: string;
}

export function GitHubOpenModal({ onClose, onOpenSettings }: GitHubOpenModalProps) {
  const pat = useSettingsStore((s) => s.githubPat);
  const existingSpec = useSpecStore((s) => s.spec);
  const setLoaded = useGithubProjectStore((s) => s.setLoaded);

  const [client] = useState<Octokit | null>(() => (pat ? makeGitHubClient(pat) : null));
  const { repos, loading: loadingRepos, error: repoListError } = useRepoList(client, pat);
  const [selectedRepoIdx, setSelectedRepoIdx] = useState<number>(-1);
  const [branches, setBranches] = useState<BranchSummary[] | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [openingProject, setOpeningProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When set, the selected repo+branch has no flowstore project; offer to initialize.
  // commitSha is null when the ref has no commits at all (truly fresh repo).
  const [initOffer, setInitOffer] = useState<
    | { repo: RepoSummary; branch: string; commitSha: string | null }
    | null
  >(null);

  // URL import state — shared between the no-PAT wall and the authenticated modal.
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlOpening, setUrlOpening] = useState(false);

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
    if (existingSpec && !window.confirm("Replace the current spec? Unsaved changes will be lost.")) return;
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
      const { spec, comments, testingArtifacts, errors, modelsConfig } = loadProject(files);
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
      loadSpec(spec, { testingArtifacts, comments, modelsConfig });
      setLoaded(
        { owner: repo.owner, repo: repo.repo, ref: selectedBranch },
        commitSha,
        repo.canWrite,
        repo.canAdmin,
      );
      // Just-loaded from GitHub — local matches remote, so re-baseline
      // dirtiness to the loaded payload. Don't stamp lastSavedAt; this wasn't
      // a save by the user.
      markProjectBaseline();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open project");
    } finally {
      setOpeningProject(false);
    }
  }

  function initializeProject() {
    if (!initOffer) return;
    // Scaffolding a fresh project replaces whatever is loaded, same as opening
    // an existing one — guard it identically so an in-progress spec can't be
    // wiped to a blank scaffold without a heads-up.
    if (existingSpec && !window.confirm("Replace the current spec with a blank project? Unsaved changes will be lost.")) return;
    const { repo, branch, commitSha } = initOffer;
    const scaffold = scaffoldNewProject({ name: repo.repo });
    loadSpec(scaffold);
    setLoaded({ owner: repo.owner, repo: repo.repo, ref: branch }, commitSha);
    onClose();
  }

  async function openFromUrl() {
    const parsed = parseGitHubUrl(urlInput);
    if (!parsed) {
      setUrlError("Not a valid GitHub URL.");
      return;
    }
    if (existingSpec && !window.confirm("Replace the current spec? Unsaved changes will be lost.")) return;
    setUrlOpening(true);
    setUrlError(null);
    try {
      // Use PAT client for rate limits + private repo access; fall back to unauthed for public.
      const readClient = client ?? new Octokit();
      const meta = await readClient.rest.repos.get({ owner: parsed.owner, repo: parsed.repo });
      const branch = parsed.branch ?? meta.data.default_branch;
      const canWrite = meta.data.permissions?.push ?? false;
      const canAdmin = meta.data.permissions?.admin ?? false;

      let files: Record<string, string>;
      let commitSha: string | null;
      try {
        const read = await readRepoToFileMap({
          client: readClient,
          owner: parsed.owner,
          repo: parsed.repo,
          ref: branch,
        });
        files = read.files;
        commitSha = read.commitSha;
      } catch (e: unknown) {
        if (typeof e === "object" && e !== null && "status" in e && (e as { status: unknown }).status === 404) {
          setUrlError("Repository or branch not found. It may be private or the branch doesn't exist.");
          return;
        }
        throw e;
      }

      const { spec, comments, testingArtifacts, errors, modelsConfig } = loadProject(files);
      if (!spec) {
        const msg =
          errors.length > 0
            ? errors.map((e) => `${e.path ? e.path + ": " : ""}${e.message}`).join("; ")
            : "No flowstore project found in this repo.";
        setUrlError(msg);
        return;
      }
      loadSpec(spec, { testingArtifacts, comments, modelsConfig });
      setLoaded(
        { owner: parsed.owner, repo: parsed.repo, ref: branch },
        commitSha,
        canWrite,
        canAdmin,
      );
      markProjectBaseline();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to open project";
      if (msg.includes("rate limit")) {
        setUrlError("GitHub rate limit hit. Add a PAT in Settings to get a higher limit.");
      } else {
        setUrlError(msg);
      }
    } finally {
      setUrlOpening(false);
    }
  }

  if (!pat) {
    return (
      <Shell title="Open GitHub project" onClose={onClose}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-zinc-700">Public repo URL</label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => { setUrlInput(e.target.value); setUrlError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") openFromUrl(); }}
                placeholder="https://github.com/owner/repo"
                className="flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
              <button
                onClick={openFromUrl}
                disabled={!urlInput.trim() || urlOpening}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
              >
                {urlOpening ? "Opening…" : "Open"}
              </button>
            </div>
            {urlError && (
              <div className="mt-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                {urlError}
              </div>
            )}
          </div>
          <div className="border-t border-zinc-100 pt-3 text-xs text-zinc-500">
            To open private repos or your own projects, add a GitHub PAT in Settings.
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            onClick={onOpenSettings}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
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
              {/* Strict filter to repos tagged `flowstore`. To bring an
                  existing repo into the list, add the topic on github.com
                  (repo → About sidebar ⚙ → Topics). */}
              {(repos ?? [])
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => r.topics.includes(FLOWSTORE_TOPIC))
                .map(({ r, i }) => (
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
        {(error ?? repoListError) && (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
            {error ?? repoListError}
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

        <div className="relative border-t border-zinc-100 pt-3">
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-white px-2 text-xs text-zinc-400">
            or paste a URL
          </span>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => { setUrlInput(e.target.value); setUrlError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") openFromUrl(); }}
            placeholder="https://github.com/owner/repo"
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          {urlError && (
            <div className="mt-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
              {urlError}
            </div>
          )}
        </div>
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
        ) : urlInput.trim() ? (
          <button
            onClick={openFromUrl}
            disabled={urlOpening}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {urlOpening ? "Opening…" : "Open"}
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
