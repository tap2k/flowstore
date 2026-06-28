import { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import { useDirtyStore } from "@/lib/store/dirty";
import { SpecChangesModal } from "./SpecChangesModal";
import {
  makeGitHubClient,
  listCommits,
  resolveCommit,
  readRepoAtTree,
  type RevisionRow,
} from "@flowstore/core/files/github";
import { loadProject } from "@flowstore/core/files";
import { loadSpec } from "@/lib/store/loadSpec";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "empty" }
  | { phase: "ready"; rows: RevisionRow[] };

export function HistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [restoring, setRestoring] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const location = useGithubProjectStore((s) => s.location);
  const currentSha = useGithubProjectStore((s) => s.lastKnownCommitSha);
  const isDirty = useDirtyStore((s) => s.isDirty);
  const pat = useSettingsStore((s) => s.githubPat);
  const branch = location?.ref ?? "this branch";

  const load = useCallback(async (signal: { cancelled: boolean }) => {
    setState({ phase: "loading" });
    setRestoring(null);
    if (!location || !pat) {
      setState({ phase: "error", message: "No project open." });
      return;
    }
    try {
      const loc = { client: makeGitHubClient(pat), owner: location.owner, repo: location.repo, ref: location.ref };
      const rows = await listCommits(loc);
      if (signal.cancelled) return;
      setState(rows.length === 0 ? { phase: "empty" } : { phase: "ready", rows });
    } catch (e) {
      if (signal.cancelled) return;
      setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [location, pat]);

  // Refetch when the panel opens and whenever HEAD advances (e.g. an in-app
  // save bumps currentSha). External pushes the app can't observe are covered
  // by the manual Refresh button.
  useEffect(() => {
    if (!open) return;
    const signal = { cancelled: false };
    void load(signal);
    return () => { signal.cancelled = true; };
  }, [open, currentSha, load]);

  async function restore(sha: string) {
    if (!location || !pat) return;
    if (!window.confirm("Restore this version? Your unsaved changes will be replaced.")) return;
    setRestoring(sha);
    try {
      const loc = { client: makeGitHubClient(pat), owner: location.owner, repo: location.repo, ref: location.ref };
      const { commitSha, treeSha } = await resolveCommit(loc, sha);
      const { files } = await readRepoAtTree(loc, commitSha, treeSha);
      const { spec, testingArtifacts, comments, modelsConfig, errors } = loadProject(files);
      if (!spec) {
        alert(errors[0]?.message ?? "Could not parse spec at this revision.");
        return;
      }
      loadSpec(spec, { testingArtifacts, comments, modelsConfig });
      // Don't update lastKnownCommitSha or call markProjectBaseline — the restored
      // spec is intentionally dirty vs HEAD so the user can review and save (revert commit).
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(null);
    }
  }

  if (!open) return null;

  return (
    <>
    <aside className="flex flex-col h-full w-[380px] shrink-0 border-l border-zinc-200 bg-white">
      <div className="flex items-start justify-between border-b border-zinc-200 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">Revision history</p>
          <p className="font-mono text-[11px] text-zinc-500">{branch}</p>
        </div>
        <div className="mt-0.5 flex items-center gap-3">
          <button
            onClick={() => void load({ cancelled: false })}
            disabled={state.phase === "loading"}
            className="text-xs text-zinc-500 hover:text-zinc-900 disabled:opacity-40"
          >
            refresh
          </button>
          <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-900">
            close
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-2 py-1">
        {state.phase === "loading" && (
          <p className="px-2 py-4 text-sm text-zinc-500">Loading history…</p>
        )}

        {state.phase === "error" && (
          <p className="px-2 py-4 text-sm text-red-600">{state.message}</p>
        )}

        {state.phase === "empty" && (
          <p className="px-2 py-4 text-sm text-zinc-600">No commits on this branch yet.</p>
        )}

        {isDirty && (
          <button
            onClick={() => setShowChanges(true)}
            className="w-full text-left px-2 py-2.5 rounded-md hover:bg-zinc-50 border-b border-zinc-100 mb-1"
          >
            <div className="flex items-baseline gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0 self-center" />
              <span className="flex-1 text-sm text-zinc-900">Working copy</span>
              <span className="text-[11px] text-zinc-400 shrink-0">unsaved</span>
            </div>
            <div className="mt-0.5 ml-3.5 text-[11px] text-zinc-400">Changes since last save</div>
          </button>
        )}

        {state.phase === "ready" && (
          <ul className="divide-y divide-zinc-100">
            {state.rows.map((row) => {
              const isCurrent = !!currentSha && row.sha === currentSha;
              const isRestoring = restoring === row.sha;
              return (
                <li key={row.sha}>
                  <button
                    disabled={isCurrent || !!restoring}
                    onClick={() => void restore(row.sha)}
                    className={[
                      "w-full text-left px-2 py-2.5 rounded-md",
                      isCurrent
                        ? "cursor-default"
                        : restoring
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-zinc-50",
                    ].join(" ")}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-zinc-400 shrink-0">
                        {row.shortSha}
                      </span>
                      <span className="flex-1 text-sm text-zinc-900 truncate">{row.message}</span>
                      {isCurrent && (
                        <span className="text-[11px] text-zinc-400 shrink-0">current</span>
                      )}
                      {isRestoring && (
                        <span className="text-[11px] text-zinc-400 shrink-0">restoring…</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex gap-2 text-[11px] text-zinc-400">
                      <span>{row.author}</span>
                      <span>·</span>
                      <span>{formatRelative(row.date)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {location && (
        <div className="border-t border-zinc-100 px-4 py-2.5">
          <a
            href={`https://github.com/${location.owner}/${location.repo}/commits/${location.ref}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-zinc-400 hover:text-zinc-700"
          >
            View on GitHub ↗
          </a>
        </div>
      )}
    </aside>

    {showChanges && <SpecChangesModal onClose={() => setShowChanges(false)} />}
    </>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
