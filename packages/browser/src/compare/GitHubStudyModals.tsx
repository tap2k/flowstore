import { useState } from "react";
import { Button, Checkbox, FieldRow, Input, Select } from "@/components/ui";
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
  onOpened,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
  onFiles: (files: Record<string, string>) => void;
  /** Fires after onFiles with the repo the study came from. */
  onOpened?: (loc: { owner: string; repo: string; ref: string }) => void;
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
      onOpened?.({ owner, repo, ref });
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
          <FieldRow label="Repository">
            {loadingRepos ? (
              <div className="fs-caption text-text-tertiary">Loading…</div>
            ) : (
              <Select
                value={String(selectedIdx)}
                onChange={(e) => {
                  setSelectedIdx(Number(e.target.value));
                  setError(null);
                }}
                options={[
                  { value: "-1", label: "— select —" },
                  ...(repos ?? [])
                    .map((r, i) => ({ r, i }))
                    .filter(({ r }) => r.topics.includes(FLOWSTORE_TOPIC))
                    .map(({ r, i }) => ({ value: String(i), label: r.full_name })),
                ]}
                className="w-full"
              />
            )}
          </FieldRow>
        ) : (
          <div className="fs-caption text-text-tertiary">
            Add a GitHub PAT in settings to list your repos; public repos open by URL below.
          </div>
        )}
        <FieldRow label={pat ? "or paste a URL" : "Public repo URL"}>
          <Input
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
            className="w-full"
          />
        </FieldRow>
        {(error ?? listError) && (
          <div className="rounded border border-state-error-line bg-state-error-bg px-2 py-1.5 text-xs text-state-error-fg">
            {error ?? listError}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        {!pat && <Button onClick={onOpenSettings}>Open Settings</Button>}
        <Button
          variant="primary"
          loading={opening}
          onClick={() => void openSelection()}
          disabled={!urlInput.trim() && selectedIdx < 0}
        >
          {opening ? "Opening…" : "Open"}
        </Button>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Save study to GitHub: push the bundle FileMap into an existing repo (the
// agency workflow — the study lands in the client's repo) or a new one.
// ---------------------------------------------------------------------------

export function GitHubStudySaveModal({
  mode,
  onClose,
  onOpenSettings,
  buildFiles,
  onSaved,
}: {
  /** Destination chosen in the toolbar dropdown (editor idiom) — the modal
      renders one form, it never toggles. */
  mode: "existing" | "new";
  onClose: () => void;
  onOpenSettings: () => void;
  buildFiles: () => Record<string, string>;
  /** Fires on a successful push with the repo the study landed in. */
  onSaved?: (loc: { owner: string; repo: string; ref: string }) => void;
}) {
  const pat = useSettingsStore((s) => s.githubPat);
  const [client] = useState<Octokit | null>(() => (pat ? makeGitHubClient(pat) : null));
  const { repos, loading: loadingRepos, error: listError } = useRepoList(client, pat);
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
      onSaved?.({ owner: r.owner, repo: r.repo, ref: r.default_branch });
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
      onSaved?.({ owner: created.owner, repo: created.repo, ref: created.defaultBranch });
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
        <div className="fs-caption text-text-tertiary">
          Saving to GitHub needs a personal access token. Add one in settings.
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={onOpenSettings}>Open Settings</Button>
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
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Save study to GitHub" onClose={onClose}>
      <div className="space-y-3">
        {mode === "existing" ? (
          <FieldRow
            label="Repository (writable)"
            hint="Writes to the default branch. If the repo is already a flowstore project, only tests/ and runs are added."
          >
            {loadingRepos ? (
              <div className="fs-caption text-text-tertiary">Loading…</div>
            ) : (
              <Select
                value={String(selectedIdx)}
                onChange={(e) => {
                  setSelectedIdx(Number(e.target.value));
                  setError(null);
                }}
                options={[
                  { value: "-1", label: "— select —" },
                  ...(repos ?? [])
                    .map((r, i) => ({ r, i }))
                    .filter(({ r }) => r.canWrite)
                    .sort(
                      (a, b) =>
                        Number(b.r.topics.includes(FLOWSTORE_TOPIC)) -
                        Number(a.r.topics.includes(FLOWSTORE_TOPIC)),
                    )
                    .map(({ r, i }) => ({ value: String(i), label: r.full_name })),
                ]}
                className="w-full"
              />
            )}
          </FieldRow>
        ) : (
          <div className="space-y-2">
            <FieldRow label="Repository name">
              <Input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full"
              />
            </FieldRow>
            <Checkbox
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              label="private repo"
            />
          </div>
        )}
        {(error ?? listError) && (
          <div className="rounded border border-state-error-line bg-state-error-bg px-2 py-1.5 text-xs text-state-error-fg">
            {error ?? listError}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          loading={saving}
          onClick={() => void (mode === "existing" ? saveExisting() : saveNew())}
          disabled={mode === "existing" ? selectedIdx < 0 : !newName.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Shell>
  );
}
