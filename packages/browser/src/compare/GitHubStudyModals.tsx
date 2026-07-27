import { useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import {
  FLOWSTORE_TOPIC,
  Shell,
  parseGitHubUrl,
  toRepoSlug,
  useRepoList,
} from "@/lib/githubUi";
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
  const { repos, loading: loadingRepos, error: listError } = useRepoList(client, pat);
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
            <label className="text-xs font-medium text-text-secondary">Repository</label>
            {loadingRepos ? (
              <div className="mt-1 text-xs text-text-tertiary">Loading…</div>
            ) : (
              <select
                value={selectedIdx}
                onChange={(e) => {
                  setSelectedIdx(Number(e.target.value));
                  setError(null);
                }}
                className="mt-1 w-full rounded border border-border-default px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-focus-ring"
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
          <div className="text-xs text-text-tertiary">
            Add a GitHub PAT in settings to list your repos; public repos open by URL below.
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-text-secondary">
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
            className="mt-1 w-full rounded border border-border-default px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-focus-ring"
          />
        </div>
        {(error ?? listError) && (
          <div className="rounded border border-state-error-line bg-state-error-bg px-2 py-1.5 text-xs text-state-error-fg">
            {error ?? listError}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-3">
        <button
          onClick={onClose}
          className="rounded-md border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-hover"
        >
          Cancel
        </button>
        {!pat && (
          <button
            onClick={onOpenSettings}
            className="rounded-md border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-hover"
          >
            Open Settings
          </button>
        )}
        <button
          onClick={() => void openSelection()}
          disabled={opening || (!urlInput.trim() && selectedIdx < 0)}
          className="rounded-md bg-emphasis px-3 py-1.5 text-xs font-medium text-emphasis-fg hover:bg-emphasis-hover disabled:opacity-50"
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
  const { repos, loading: loadingRepos, error: listError } = useRepoList(client, pat);
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
        name: toRepoSlug(newName, "compare-study"),
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
        <div className="text-xs text-text-tertiary">
          Saving to GitHub needs a personal access token. Add one in settings.
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <button
            onClick={onClose}
            className="rounded-md border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            onClick={onOpenSettings}
            className="rounded-md border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-hover"
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
        <div className="space-y-2 text-xs text-text-secondary">
          <div>
            Pushed to{" "}
            <a href={done.url} target="_blank" rel="noreferrer" className="font-medium underline">
              {done.url.replace("https://github.com/", "")}
            </a>
            .
          </div>
          {done.note && <div className="text-state-warning-fg">{done.note}</div>}
          <div className="text-text-tertiary">
            It's a flowstore project — the editor opens it from GitHub as-is.
          </div>
        </div>
        <div className="flex justify-end pt-3">
          <button
            onClick={onClose}
            className="rounded-md bg-emphasis px-3 py-1.5 text-xs font-medium text-emphasis-fg hover:bg-emphasis-hover"
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
        <div className="flex gap-1 rounded-md border border-border-default p-0.5 text-xs">
          {(["existing", "new"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`flex-1 rounded px-2 py-1 ${mode === m ? "bg-emphasis text-emphasis-fg" : "text-text-secondary hover:bg-surface-hover"}`}
            >
              {m === "existing" ? "existing repo" : "new repo"}
            </button>
          ))}
        </div>
        {mode === "existing" ? (
          <div>
            <label className="text-xs font-medium text-text-secondary">Repository (writable)</label>
            {loadingRepos ? (
              <div className="mt-1 text-xs text-text-tertiary">Loading…</div>
            ) : (
              <select
                value={selectedIdx}
                onChange={(e) => {
                  setSelectedIdx(Number(e.target.value));
                  setError(null);
                }}
                className="mt-1 w-full rounded border border-border-default px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-focus-ring"
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
            <div className="mt-1 text-[10px] text-text-tertiary">
              Writes to the default branch. If the repo is already a flowstore project, only
              tests/ and runs are added.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <label className="text-xs font-medium text-text-secondary">Repository name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded border border-border-default px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-focus-ring"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-text-secondary">
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
          <div className="rounded border border-state-error-line bg-state-error-bg px-2 py-1.5 text-xs text-state-error-fg">
            {error ?? listError}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-3">
        <button
          onClick={onClose}
          className="rounded-md border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-hover"
        >
          Cancel
        </button>
        <button
          onClick={() => void (mode === "existing" ? saveExisting() : saveNew())}
          disabled={saving || (mode === "existing" ? selectedIdx < 0 : !newName.trim())}
          className="rounded-md bg-emphasis px-3 py-1.5 text-xs font-medium text-emphasis-fg hover:bg-emphasis-hover disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Shell>
  );
}
