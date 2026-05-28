import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { useSpecStore } from "@/lib/store/spec";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import {
  ConflictError,
  isForbidden,
  makeGitHubClient,
  readRepoToFileMap,
  writeFileMapToRepo,
} from "@flowstore/core/files/github";
import { decomposeSpec, loadProject } from "@flowstore/core/files";
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

function ShareIcon() {
  // Person-plus glyph — universal "add someone" affordance.
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
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

export function GitHubProjectControls({
  onSaveToGitHub,
  onShare,
}: {
  onSaveToGitHub: () => void;
  onShare: () => void;
}) {
  const pat = useSettingsStore((s) => s.githubPat);
  const spec = useSpecStore((s) => s.spec);
  const location = useGithubProjectStore((s) => s.location);
  const lastSha = useGithubProjectStore((s) => s.lastKnownCommitSha);
  const canWrite = useGithubProjectStore((s) => s.canWrite);
  const setSpec = useSpecStore((s) => s.setSpec);
  const setLoaded = useGithubProjectStore((s) => s.setLoaded);
  const setCommitSha = useGithubProjectStore((s) => s.setCommitSha);
  const setCanWrite = useGithubProjectStore((s) => s.setCanWrite);

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

  if (!spec) return null;
  // Local project — not yet on GitHub. The cloud prompts to save (create a repo).
  if (!location) {
    return (
      <button
        onClick={onSaveToGitHub}
        className={iconButtonClass}
        title="Save to GitHub"
        aria-label="Save to GitHub"
      >
        <SaveIcon />
      </button>
    );
  }
  if (!pat) return null;

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
        "Update spec from flowstore editor",
        opts,
      );
      setCommitSha(res.commitSha);
    } catch (e) {
      if (e instanceof ConflictError) {
        setConflictRemoteSha(e.actual ?? "");
      } else if (isForbidden(e)) {
        // Token-scope read-only, or perms changed since open: re-route the
        // user to "Save a copy" rather than surface a raw 403.
        setCanWrite(false);
        setError("You have read-only access to this project — saving as a copy.");
        onSaveToGitHub();
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
        "Update spec from flowstore editor",
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

  // Read-only project (read collaborator, org read, or detected via 403):
  // the cloud relabels to "Save a copy" — clicking it opens the save-to-new
  // -repo modal that forks the current spec into a repo the user owns.
  if (!canWrite) {
    return (
      <>
        <button
          onClick={onSaveToGitHub}
          className={iconButtonClass}
          title="Save a copy to your account"
          aria-label="Save a copy"
        >
          <SaveIcon />
        </button>
        <button
          onClick={doRefresh}
          disabled={refreshing}
          className={iconButtonClass}
          title="Get latest"
          aria-label="Get latest"
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
      </>
    );
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
      <button
        onClick={onShare}
        className={iconButtonClass}
        title="Share — manage collaborators"
        aria-label="Share"
      >
        <ShareIcon />
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
          onCancel={() => setConflictRemoteSha(null)}
          onSaveAsDraft={() => {
            setConflictRemoteSha(null);
            setNewBranchOpen(true);
          }}
          onGetLatest={() => {
            setConflictRemoteSha(null);
            void doRefresh();
          }}
          onOverwrite={() => {
            if (
              !window.confirm(
                "Overwrite the saved version with yours? Their changes will be lost.",
              )
            )
              return;
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
  onCancel: () => void;
  onSaveAsDraft: () => void;
  onGetLatest: () => void;
  onOverwrite: () => void;
}

// Conflict on Save: someone else pushed to the same branch since we opened
// it. Default action is the *safe* one — save the user's work as a new draft
// branch so nothing is lost on either side. "Get latest" discards the user's
// edits; "Overwrite" discards the collaborator's edits and is gated by a
// browser confirm to make destruction a deliberate two-step.
function ConflictModal({
  onCancel,
  onSaveAsDraft,
  onGetLatest,
  onOverwrite,
}: ConflictModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-zinc-900 mb-2">
          Someone else saved changes
        </h2>
        <p className="text-sm text-zinc-700 mb-4">
          Another collaborator saved to this project while you were editing.
          Save yours as a separate <strong>draft</strong> — nothing gets lost,
          and the two versions can be combined later.
        </p>
        <div className="space-y-2">
          <button
            onClick={onSaveAsDraft}
            className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Save as a new draft
          </button>
          <button
            onClick={onGetLatest}
            className="w-full rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Get latest &amp; discard my edits
          </button>
          <button
            onClick={onOverwrite}
            className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
          >
            Overwrite their changes
          </button>
          <button
            onClick={onCancel}
            className="w-full px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-900"
          >
            Cancel
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
