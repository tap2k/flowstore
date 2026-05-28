import { useState } from "react";
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
import { decomposeSpec } from "@flowstore/core/files";

interface SaveToNewRepoModalProps {
  onClose: () => void;
  onOpenSettings: () => void;
}

// GitHub repo names allow [A-Za-z0-9._-]; everything else collapses to a dash.
function toRepoSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled-agent"
  );
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

  const [name, setName] = useState(spec?.agent.meta.name ?? "");
  const [isPrivate, setIsPrivate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = toRepoSlug(name);

  if (!pat) {
    return (
      <Shell onClose={onClose}>
        <p className="text-sm text-zinc-700">
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
      const fileMap = decomposeSpec(spec);
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
      <h2 className="text-lg font-semibold text-zinc-900 mb-2">Save to GitHub</h2>
      <label className="text-xs font-medium text-zinc-700">Project name</label>
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        placeholder="Acme Onboarding Bot"
        className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
      />

      <div className="mt-3 flex gap-4 text-sm text-zinc-700">
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

      <p className="mt-3 text-[11px] text-zinc-500">
        Creates <span className="font-mono">{login ? `${login}/` : ""}{slug}</span>, commits
        the current agent, and opens it.
      </p>

      {error && (
        <p className="mt-2 text-[11px] text-red-700">{error}</p>
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
  "rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700";
const secondaryBtn =
  "rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100";

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
