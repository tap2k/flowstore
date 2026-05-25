import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { useSpecStore } from "@/lib/store/spec";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import {
  ConflictError,
  makeGitHubClient,
  readRepoToFileMap,
  writeFileMapToRepo,
} from "@uxflows/core/files/github";
import { decomposeSpec, loadProject } from "@uxflows/core/files";
import { useCommentsStore } from "@/lib/store/comments";

const iconButtonClass =
  "rounded-md border border-zinc-200 p-1.5 text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 disabled:hover:bg-transparent";
const menuItemClass =
  "block w-full text-left px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100";

function SaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export function GitHubProjectControls() {
  const pat = useSettingsStore((s) => s.githubPat);
  const spec = useSpecStore((s) => s.spec);
  const location = useGithubProjectStore((s) => s.location);
  const lastSha = useGithubProjectStore((s) => s.lastKnownCommitSha);
  const setSpec = useSpecStore((s) => s.setSpec);
  const setLoaded = useGithubProjectStore((s) => s.setLoaded);
  const setCommitSha = useGithubProjectStore((s) => s.setCommitSha);

  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictRemoteSha, setConflictRemoteSha] = useState<string | null>(null);
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!saveMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!saveMenuRef.current?.contains(e.target as Node)) setSaveMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSaveMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [saveMenuOpen]);

  if (!location || !spec || !pat) return null;

  async function doSave(force: boolean) {
    if (!location || !spec) return;
    setSaving(true);
    setError(null);
    try {
      const client = makeGitHubClient(pat);
      const fileMap = decomposeSpec(spec);
      const opts = force ? {} : { expectedCommitSha: lastSha ?? undefined };
      const res = await writeFileMapToRepo(
        { client, owner: location.owner, repo: location.repo, ref: location.ref },
        fileMap,
        "Update spec from uxflows editor",
        opts,
      );
      setCommitSha(res.commitSha);
    } catch (e) {
      if (e instanceof ConflictError) {
        setConflictRemoteSha(e.actual ?? "");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  }

  async function doRefresh() {
    if (!location) return;
    if (!window.confirm("Replace the current spec with the latest from GitHub?")) return;
    setRefreshing(true);
    setError(null);
    try {
      const client = makeGitHubClient(pat);
      const { files, commitSha } = await readRepoToFileMap({
        client,
        owner: location.owner,
        repo: location.repo,
        ref: location.ref,
      });
      const { spec: loaded, comments, errors } = loadProject(files);
      if (!loaded) {
        setError(errors.map((e) => e.message).join("; ") || "Refresh failed");
        return;
      }
      setSpec(loaded);
      setCommitSha(commitSha);
      useCommentsStore.getState().setAll(comments);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function doSaveToNewBranch(branchName: string) {
    if (!location || !spec) return;
    setSaving(true);
    setError(null);
    try {
      const client = makeGitHubClient(pat);
      const sourceRef = await client.rest.git.getRef({
        owner: location.owner,
        repo: location.repo,
        ref: `heads/${location.ref}`,
      });
      await client.rest.git.createRef({
        owner: location.owner,
        repo: location.repo,
        ref: `refs/heads/${branchName}`,
        sha: sourceRef.data.object.sha,
      });
      const fileMap = decomposeSpec(spec);
      const res = await writeFileMapToRepo(
        { client, owner: location.owner, repo: location.repo, ref: branchName },
        fileMap,
        "Update spec from uxflows editor",
      );
      setLoaded(
        { owner: location.owner, repo: location.repo, ref: branchName },
        res.commitSha,
      );
      setNewBranchOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div ref={saveMenuRef} className="relative">
        <button
          onClick={() => setSaveMenuOpen((o) => !o)}
          disabled={saving}
          className={iconButtonClass}
          title="Save to GitHub"
          aria-label="Save to GitHub"
        >
          {saving ? <Spinner /> : <SaveIcon />}
        </button>
        {saveMenuOpen && (
          <div className="absolute right-0 top-full mt-1 z-20 min-w-[14rem] rounded-md border border-zinc-200 bg-white shadow-md py-1">
            <button
              onClick={() => {
                setSaveMenuOpen(false);
                void doSave(false);
              }}
              className={menuItemClass}
            >
              Save to <span className="font-mono">{location.ref}</span>
            </button>
            <button
              onClick={() => {
                setSaveMenuOpen(false);
                setNewBranchOpen(true);
              }}
              className={menuItemClass}
            >
              Save to a new branch…
            </button>
          </div>
        )}
      </div>
      <button
        onClick={doRefresh}
        disabled={refreshing}
        className={iconButtonClass}
        title="Refresh from GitHub"
        aria-label="Refresh from GitHub"
      >
        {refreshing ? <Spinner /> : <RefreshIcon />}
      </button>

      {error && (
        <div className="absolute top-full right-6 mt-2 z-30 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800 shadow-md">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-600 hover:text-red-900">
            dismiss
          </button>
        </div>
      )}

      {conflictRemoteSha !== null && (
        <ConflictModal
          remoteSha={conflictRemoteSha}
          onCancel={() => setConflictRemoteSha(null)}
          onRefreshFirst={() => {
            setConflictRemoteSha(null);
            void doRefresh();
          }}
          onSaveAnyway={() => {
            setConflictRemoteSha(null);
            void doSave(true);
          }}
        />
      )}

      {newBranchOpen && (
        <NewBranchModal
          baseBranch={location.ref}
          saving={saving}
          onCancel={() => setNewBranchOpen(false)}
          onSubmit={doSaveToNewBranch}
        />
      )}
    </>
  );
}

interface ConflictModalProps {
  remoteSha: string;
  onCancel: () => void;
  onRefreshFirst: () => void;
  onSaveAnyway: () => void;
}

function ConflictModal({ remoteSha, onCancel, onRefreshFirst, onSaveAnyway }: ConflictModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-zinc-900 mb-2">Remote changed</h2>
        <p className="text-sm text-zinc-700 mb-4">
          The spec changed on GitHub since you opened it (remote at{" "}
          <span className="font-mono text-xs">{remoteSha.slice(0, 7)}</span>). Refresh
          first and re-apply your edits, or save anyway and overwrite the remote
          changes.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            onClick={onSaveAnyway}
            className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
          >
            Save anyway
          </button>
          <button
            onClick={onRefreshFirst}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
          >
            Refresh first
          </button>
        </div>
      </div>
    </div>
  );
}

interface NewBranchModalProps {
  baseBranch: string;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (branchName: string) => void;
}

function NewBranchModal({ baseBranch, saving, onCancel, onSubmit }: NewBranchModalProps) {
  const [name, setName] = useState("");
  const valid = /^[a-zA-Z0-9._/-]+$/.test(name) && !name.startsWith("/") && !name.endsWith("/");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-zinc-900 mb-2">Save to a new branch</h2>
        <p className="text-xs text-zinc-600 mb-3">
          Forks off <span className="font-mono">{baseBranch}</span> at its current HEAD,
          writes your edits to the new branch, and switches the editor to it.
        </p>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-draft"
          className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
        />
        {!valid && name && (
          <p className="mt-1 text-[11px] text-red-700">
            Use letters, numbers, dot, dash, underscore, or slash. No leading/trailing slash.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-3">
          <button
            onClick={onCancel}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            onClick={() => valid && onSubmit(name)}
            disabled={!valid || saving}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save to branch"}
          </button>
        </div>
      </div>
    </div>
  );
}
