import { useState } from "react";
import { toRepoSlug } from "@/lib/githubUi";
import { useSettingsStore } from "@/lib/store/settings";
import { useSpecStore } from "@/lib/store/spec";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import {
  createRepo,
  isRepoNameTaken,
  makeGitHubClient,
  tagRepoTopic,
  writeFileMapToRepo,
} from "@flowstore/core/files/github";
import { decomposeSpec, decomposeTestingArtifacts } from "@flowstore/core/files";
import { useTestsStore } from "@/lib/store/tests";
import { useDirtyStore } from "@/lib/store/dirty";

interface SaveToNewRepoModalProps {
  onClose: () => void;
  onOpenSettings: () => void;
}

// "Save to GitHub" / "New project" / "Save as a copy" all funnel here — the
// op is identical (create a repo, write the current spec as the first
// commit), only the seed spec differs. Creates the repo from whatever is in
// the editor and switches the editor onto it.
export function SaveToNewRepoModal({ onClose, onOpenSettings }: SaveToNewRepoModalProps) {
  const pat = useSettingsStore((s) => s.githubPat);
  const login = useSettingsStore((s) => s.githubLogin);
  const spec = useSpecStore((s) => s.spec);
  const setLoaded = useGithubProjectStore((s) => s.setLoaded);

  const [name, setName] = useState(spec?.agent.name ?? "");
  const [isPrivate, setIsPrivate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = toRepoSlug(name, "untitled-agent");

  if (!pat) {
    return (
      <Shell onClose={onClose}>
        <p className="fs-body text-text-secondary">
          Connect GitHub to save this project. Add a token in Settings.
        </p>
        <div className="flex justify-end gap-2 pt-3">
          <button onClick={onClose} className={secondaryBtn}>
            Cancel
          </button>
          <button onClick={onOpenSettings} className={primaryBtn}>
            Open Settings
          </button>
        </div>
      </Shell>
    );
  }

  async function create() {
    if (!spec || !name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const client = makeGitHubClient(pat);
      const created = await createRepo(client, { name: slug, private: isPrivate });
      const fileMap = {
        ...decomposeSpec(spec),
        ...decomposeTestingArtifacts(useTestsStore.getState().toTestingArtifacts()),
      };
      const res = await writeFileMapToRepo(
        { client, owner: created.owner, repo: created.repo, ref: created.defaultBranch },
        fileMap,
        "Initial commit from flowstore",
      );
      await tagRepoTopic(client, created.owner, created.repo);
      setLoaded(
        { owner: created.owner, repo: created.repo, ref: created.defaultBranch },
        res.commitSha,
      );
      // Brand-new repos can have HEAD drift right after creation —
      // account-installed GitHub Apps push housekeeping commits, or the
      // git-data write we just made can race a deferred finalization by
      // GitHub itself. There can't be a real collaborator conflict on a
      // repo this fresh, so the next save bypasses the conflict check.
      useGithubProjectStore.getState().setPendingForceSave(true);
      useDirtyStore.getState().markSaved();
      onClose();
    } catch (e) {
      if (isRepoNameTaken(e)) {
        setError(
          `You already have a project named "${slug}". Choose a different name, ` +
            `or open the existing one from "Open from GitHub".`,
        );
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Shell onClose={onClose}>
      <h2 className="text-lg font-semibold text-text-primary mb-2">Save to GitHub</h2>
      <label className="fs-label text-text-secondary">Project name</label>
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        placeholder="Acme Onboarding Bot"
        className="mt-1 w-full rounded border border-border-default px-2 py-1.5 fs-body focus:outline-none focus:ring-1 focus:ring-focus-ring"
      />

      <div className="mt-3 flex gap-4 fs-body text-text-secondary">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={isPrivate}
            onChange={() => setIsPrivate(true)}
          />
          Private
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={!isPrivate}
            onChange={() => setIsPrivate(false)}
          />
          Public
        </label>
      </div>

      <p className="mt-3 text-[11px] text-text-tertiary">
        Creates <span className="font-mono">{login ? `${login}/` : ""}{slug}</span>, commits
        the current agent, and opens it.
      </p>

      {error && (
        <p className="mt-2 text-[11px] text-state-error-fg">{error}</p>
      )}

      <div className="flex justify-end gap-2 pt-3">
        <button onClick={onClose} className={secondaryBtn}>
          Cancel
        </button>
        <button
          onClick={() => void create()}
          disabled={!name.trim() || saving}
          className={`${primaryBtn} disabled:opacity-50`}
        >
          {saving ? "Creating…" : "Create project"}
        </button>
      </div>
    </Shell>
  );
}

const primaryBtn =
  "rounded-md bg-emphasis px-3 py-1.5 fs-label text-emphasis-fg hover:bg-emphasis-hover";
const secondaryBtn =
  "rounded-md border border-border-default px-3 py-1.5 fs-label text-text-secondary hover:bg-surface-hover";

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fs-fade-in items-center justify-center bg-surface-scrim p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md animate-fs-pop-in rounded-4 border border-border-default bg-surface-raised p-5 shadow-elev-3"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
