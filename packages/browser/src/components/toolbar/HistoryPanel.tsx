import { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import { useDirtyStore } from "@/lib/store/dirty";
import { SpecChangesModal } from "./SpecChangesModal";
import { SheetShell } from "@/components/sheets/SheetShell";
import { Button } from "@/components/ui";
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
    {/* A modal, not a docked panel: history is a lookup you do and dismiss,
        and the four workspace panels are reserved for surfaces you work
        alongside the canvas. */}
    <SheetShell
      title="Revision history"
      inlineMeta={branch}
      maxWidth="max-w-xl"
      onClose={onClose}
      bodyClass="flex-1 overflow-auto px-2 py-1"
      headerActions={
        <Button
          size="sm"
          onClick={() => void load({ cancelled: false })}
          disabled={state.phase === "loading"}
        >
          Refresh
        </Button>
      }
      footer={
        location ? (
          <a
            href={`https://github.com/${location.owner}/${location.repo}/commits/${location.ref}`}
            target="_blank"
            rel="noreferrer"
            className="fs-caption text-text-tertiary hover:text-text-primary"
          >
            View on GitHub ↗
          </a>
        ) : undefined
      }
    >
      <div>
        {state.phase === "loading" && (
          <p className="px-2 py-4 fs-body text-text-tertiary">Loading history…</p>
        )}

        {state.phase === "error" && (
          <p className="px-2 py-4 fs-body text-state-error-fg">{state.message}</p>
        )}

        {state.phase === "empty" && (
          <p className="px-2 py-4 fs-body text-text-secondary">No commits on this branch yet.</p>
        )}

        {isDirty && (
          <button
            onClick={() => setShowChanges(true)}
            className="w-full text-left px-2 py-2.5 rounded-md hover:bg-surface-hover border-b border-border-subtle mb-1"
          >
            <div className="flex items-baseline gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-state-warning-line shrink-0 self-center" />
              <span className="flex-1 fs-body text-text-primary">Working copy</span>
              <span className="text-[11px] text-text-tertiary shrink-0">unsaved</span>
            </div>
            <div className="mt-0.5 ml-3.5 text-[11px] text-text-tertiary">Changes since last save</div>
          </button>
        )}

        {state.phase === "ready" && (
          <ul className="divide-y divide-border-subtle">
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
                          : "hover:bg-surface-hover",
                    ].join(" ")}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-text-tertiary shrink-0">
                        {row.shortSha}
                      </span>
                      <span className="flex-1 fs-body text-text-primary truncate">{row.message}</span>
                      {isCurrent && (
                        <span className="text-[11px] text-text-tertiary shrink-0">current</span>
                      )}
                      {isRestoring && (
                        <span className="text-[11px] text-text-tertiary shrink-0">restoring…</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex gap-2 text-[11px] text-text-tertiary">
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
    </SheetShell>

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
