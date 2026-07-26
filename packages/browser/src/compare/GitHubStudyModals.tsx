import { useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import {
  Octokit,
  createRepo,
  isRepoNameTaken,
  makeGitHubClient,
  readRepoToFileMap,
  tagRepoTopic,
  writeFileMapToRepo,
} from "@flowstore/core/files/github";

// Compare's GitHub flows, mirroring the editor's GitHubOpenModal /
// SaveToNewRepoModal idioms (same PAT from the shared settings store, same
// flowstore-topic filter, same modal shell). Git is the graduation bus:
// compare pushes the study repo; the editor opens it — no bundle dance.

interface RepoSummary {
  full_name: string;
  owner: string;
  repo: string;
  default_branch: string;
  canWrite: boolean;
  topics: string[];
}

const FLOWSTORE_TOPIC = "flowstore";

// Accepts https://github.com/owner/repo[/tree/branch] or owner/repo shorthand.
function parseGitHubUrl(input: string): { owner: string; repo: string; branch?: string } | null {
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

function useRepoList(client: Octokit | null) {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    setLoading(true);
    client.rest.repos
      .listForAuthenticatedUser({ sort: "updated", per_page: 100, type: "all" })
      .then((res) =>
        setRepos(
          res.data.map((r) => ({
            full_name: r.full_name,
            owner: r.owner.login,
            repo: r.name,
            default_branch: r.default_branch,
            canWrite: r.permissions?.push ?? false,
            topics: r.topics ?? [],
          })),
        ),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to fetch repos"))
      .finally(() => setLoading(false));
  }, [client]);
  return { repos, loading, error };
}

// ---------------------------------------------------------------------------
// Open study from GitHub: repo → FileMap → onFiles (the page's applyBundle).
// ---------------------------------------------------------------------------

export function GitHubStudyOpenModal({
  onClose,
  onOpenSettings,
  onFiles,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
  onFiles: (files: Record<string, string>) => void;
}) {
  const pat = useSettingsStore((s) => s.githubPat);
  const [client] = useState<Octokit | null>(() => (pat ? makeGitHubClient(pat) : null));
  const { repos, loading: loadingRepos, error: listError } = useRepoList(client);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [urlInput, setUrlInput] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(owner: string, repo: string, ref: string, readClient: Octokit) {
    setOpening(true);
    setError(null);
    try {
      const { files } = await readRepoToFileMap({ client: readClient, owner, repo, ref });
      if (!files["agent.json"]) {
        setError("No flowstore project found in this repo (missing agent.json).");
        return;
      }
      onFiles(files);
      onClose();
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "status" in e && (e as { status: unknown }).status === 404) {
        setError("Repository or branch not found. It may be private or empty.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to open study");
      }
    } finally {
      setOpening(false);
    }
  }

  async function openSelection() {
    const url = urlInput.trim();
    if (url) {
      const parsed = parseGitHubUrl(url);
      if (!parsed) {
        setError("Not a valid GitHub URL.");
        return;
      }
      const readClient = client ?? new Octokit();
      try {
        const meta = await readClient.rest.repos.get({ owner: parsed.owner, repo: parsed.repo });
        await open(parsed.owner, parsed.repo, parsed.branch ?? meta.data.default_branch, readClient);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to open study");
      }
      return;
    }
    if (!client || !repos || selectedIdx < 0) return;
    const r = repos[selectedIdx];
    await open(r.owner, r.repo, r.default_branch, client);
  }

  return (
    <Shell title="Open study from GitHub" onClose={onClose}>
      <div className="space-y-3">
        {pat ? (
          <div>
            <label className="text-xs font-medium text-zinc-700">Repository</label>
            {loadingRepos ? (
              <div className="mt-1 text-xs text-zinc-500">Loading…</div>
            ) : (
              <select
                value={selectedIdx}
                onChange={(e) => {
                  setSelectedIdx(Number(e.target.value));
                  setError(null);
                }}
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
              >
                <option value={-1}>— select —</option>
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
        ) : (
          <div className="text-xs text-zinc-500">
            Add a GitHub PAT in settings to list your repos; public repos open by URL below.
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-zinc-700">
            {pat ? "or paste a URL" : "Public repo URL"}
          </label>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void openSelection();
            }}
            placeholder="https://github.com/owner/repo"
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </div>
        {(error ?? listError) && (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
            {error ?? listError}
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
        {!pat && (
          <button
            onClick={onOpenSettings}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Open Settings
          </button>
        )}
        <button
          onClick={() => void openSelection()}
          disabled={opening || (!urlInput.trim() && selectedIdx < 0)}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {opening ? "Opening…" : "Open"}
        </button>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Save study to GitHub: push the bundle FileMap into an existing repo (the
// agency workflow — the study lands in the client's repo) or a new one.
// ---------------------------------------------------------------------------

// GitHub repo names allow [A-Za-z0-9._-]; everything else collapses to a dash.
function toRepoSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "compare-study"
  );
}

export function GitHubStudySaveModal({
  onClose,
  onOpenSettings,
  buildFiles,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
  buildFiles: () => Record<string, string>;
}) {
  const pat = useSettingsStore((s) => s.githubPat);
  const [client] = useState<Octokit | null>(() => (pat ? makeGitHubClient(pat) : null));
  const { repos, loading: loadingRepos, error: listError } = useRepoList(client);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [newName, setNewName] = useState(
    `compare-study-${new Date().toISOString().slice(0, 10)}`,
  );
  const [isPrivate, setIsPrivate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string; note?: string } | null>(null);

  async function saveExisting() {
    if (!client || !repos || selectedIdx < 0) return;
    const r = repos[selectedIdx];
    setSaving(true);
    setError(null);
    try {
      let files = buildFiles();
      let note: string | undefined;
      // Clobber guard: pushing a study into a repo that already IS a
      // flowstore project must not overwrite its agent.json/flowstore.json —
      // there, only the testing artifacts (cases, golds, runs) land.
      try {
        await client.rest.repos.getContent({
          owner: r.owner,
          repo: r.repo,
          path: "agent.json",
          ref: r.default_branch,
        });
        files = Object.fromEntries(
          Object.entries(files).filter(
            ([p]) => p !== "agent.json" && p !== "flowstore.json",
          ),
        );
        note = "Existing flowstore project detected — wrote tests/ and runs only (agent.json untouched).";
      } catch {
        // No agent.json (or empty repo) → write the full bundle.
      }
      await writeFileMapToRepo(
        { client, owner: r.owner, repo: r.repo, ref: r.default_branch },
        files,
        "Add compare study",
      );
      setDone({ url: `https://github.com/${r.owner}/${r.repo}`, note });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save study");
    } finally {
      setSaving(false);
    }
  }

  async function saveNew() {
    if (!client) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createRepo(client, {
        name: toRepoSlug(newName),
        private: isPrivate,
        description: "Model comparison study (flowstore)",
      });
      await tagRepoTopic(client, created.owner, created.repo, FLOWSTORE_TOPIC);
      await writeFileMapToRepo(
        { client, owner: created.owner, repo: created.repo, ref: created.defaultBranch },
        buildFiles(),
        "Add compare study",
      );
      setDone({ url: `https://github.com/${created.owner}/${created.repo}` });
    } catch (e) {
      if (isRepoNameTaken(e)) setError("A repo with that name already exists.");
      else setError(e instanceof Error ? e.message : "Failed to create repo");
    } finally {
      setSaving(false);
    }
  }

  if (!pat) {
    return (
      <Shell title="Save study to GitHub" onClose={onClose}>
        <div className="text-xs text-zinc-500">
          Saving to GitHub needs a personal access token. Add one in settings.
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

  if (done) {
    return (
      <Shell title="Study saved" onClose={onClose}>
        <div className="space-y-2 text-xs text-zinc-700">
          <div>
            Pushed to{" "}
            <a href={done.url} target="_blank" rel="noreferrer" className="font-medium underline">
              {done.url.replace("https://github.com/", "")}
            </a>
            .
          </div>
          {done.note && <div className="text-amber-800">{done.note}</div>}
          <div className="text-zinc-500">
            It's a flowstore project — the editor opens it from GitHub as-is.
          </div>
        </div>
        <div className="flex justify-end pt-3">
          <button
            onClick={onClose}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
          >
            Done
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Save study to GitHub" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-1 rounded-md border border-zinc-200 p-0.5 text-xs">
          {(["existing", "new"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`flex-1 rounded px-2 py-1 ${mode === m ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
            >
              {m === "existing" ? "existing repo" : "new repo"}
            </button>
          ))}
        </div>
        {mode === "existing" ? (
          <div>
            <label className="text-xs font-medium text-zinc-700">Repository (writable)</label>
            {loadingRepos ? (
              <div className="mt-1 text-xs text-zinc-500">Loading…</div>
            ) : (
              <select
                value={selectedIdx}
                onChange={(e) => {
                  setSelectedIdx(Number(e.target.value));
                  setError(null);
                }}
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
              >
                <option value={-1}>— select —</option>
                {(repos ?? [])
                  .map((r, i) => ({ r, i }))
                  .filter(({ r }) => r.canWrite)
                  .sort(
                    (a, b) =>
                      Number(b.r.topics.includes(FLOWSTORE_TOPIC)) -
                      Number(a.r.topics.includes(FLOWSTORE_TOPIC)),
                  )
                  .map(({ r, i }) => (
                    <option key={r.full_name} value={i}>
                      {r.full_name}
                    </option>
                  ))}
              </select>
            )}
            <div className="mt-1 text-[10px] text-zinc-500">
              Writes to the default branch. If the repo is already a flowstore project, only
              tests/ and runs are added.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <label className="text-xs font-medium text-zinc-700">Repository name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-zinc-700">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              private repo
            </label>
          </div>
        )}
        {(error ?? listError) && (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
            {error ?? listError}
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
          onClick={() => void (mode === "existing" ? saveExisting() : saveNew())}
          disabled={saving || (mode === "existing" ? selectedIdx < 0 : !newName.trim())}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Shell>
  );
}

// Same modal shell as the editor's GitHub modals.
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
        <h2 className="text-lg font-semibold text-zinc-900 mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}
