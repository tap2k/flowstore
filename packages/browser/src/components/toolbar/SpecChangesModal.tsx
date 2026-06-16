// "Changes since last save" modal — opened from the header save-state pill.
//
// Fetches the saved spec at the live branch tip (HEAD) and shows a semantic,
// id-resolved diff against the in-memory working copy. We diff against live
// HEAD — not the working copy's base commit — on purpose: with collaborators,
// HEAD may have advanced, and the user wants to see what a Save would actually
// change against the current remote. When HEAD has moved past the commit our
// working copy descends from, we surface a one-line notice so changes a
// collaborator pushed aren't silently attributed to the user's own edits.
//
// The fetch runs on open (a click), never on hover — one GitHub read per open.

import { useEffect, useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import { useSettingsStore } from "@/lib/store/settings";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import { makeGitHubClient, readRepoToFileMap } from "@flowstore/core/files/github";
import { loadProject } from "@flowstore/core/files";
import { diffSpecs, renderSpecDiff, diffTestingArtifacts, renderTestingArtifactsDiff } from "@flowstore/core/spec/diff";
import { useTestsStore } from "@/lib/store/tests";
import { markProjectBaseline } from "@/lib/store/dirty";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  // No spec committed at the branch tip yet — everything in the working copy
  // is new. We don't render a diff (there's no base); the message explains it.
  | { phase: "no-base" }
  | { phase: "ready"; text: string; remoteAdvanced: boolean };

export function SpecChangesModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const branchLabel = useGithubProjectStore((s) => s.location?.ref ?? "this branch");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const working = useSpecStore.getState().spec;
      const loc = useGithubProjectStore.getState().location;
      const pat = useSettingsStore.getState().githubPat;
      if (!working) return setState({ phase: "error", message: "No spec is loaded in the editor." });
      if (!loc) return setState({ phase: "error", message: "No GitHub project is open — open or save a repo first." });
      if (!pat) return setState({ phase: "error", message: "No GitHub token configured — add a PAT in Settings." });

      const ghLoc = { client: makeGitHubClient(pat), owner: loc.owner, repo: loc.repo, ref: loc.ref };
      try {
        // base = live branch tip (HEAD); head = unsaved working copy. Read the
        // filemap directly (rather than via specAtRef) so loadProject's own
        // errors are visible — a null spec here usually means no spec has been
        // committed to this branch yet, which is a "no base" state, not a fault.
        const { files, commitSha } = await readRepoToFileMap(ghLoc);
        const { spec: baseSpec, testingArtifacts: baseArtifacts, errors } = loadProject(files);
        if (cancelled) return;
        if (!baseSpec) {
          // No agent.json at root → nothing saved here to diff against.
          if (files["agent.json"] === undefined) return setState({ phase: "no-base" });
          // agent.json exists but failed to load — surface the real reason.
          const why = errors[0]?.message ?? "the saved spec could not be parsed";
          return setState({ phase: "error", message: `Could not read the saved spec: ${why}` });
        }
        const specDiff = diffSpecs(baseSpec, working, { baseSha: commitSha, textSnippets: true });
        const workingArtifacts = useTestsStore.getState().toTestingArtifacts();
        const artifactDiffs = diffTestingArtifacts(baseArtifacts, workingArtifacts);
        const parts: string[] = [];
        if (!specDiff.empty) parts.push(renderSpecDiff(specDiff));
        if (artifactDiffs.length > 0) parts.push(renderTestingArtifactsDiff(artifactDiffs));
        const knownBase = useGithubProjectStore.getState().lastKnownCommitSha;
        const remoteAdvanced = !!knownBase && knownBase !== commitSha;
        const empty = specDiff.empty && artifactDiffs.length === 0;
        if (empty) {
          // Confirmed clean against GitHub — re-baseline and dismiss.
          markProjectBaseline();
          onClose();
          return;
        }
        setState({
          phase: "ready",
          text: parts.join("\n"),
          remoteAdvanced,
        });
      } catch (e) {
        if (cancelled) return;
        setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold text-zinc-900">Changes since last save</h2>
          <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-900">
            close
          </button>
        </div>

        {state.phase === "loading" && (
          <p className="text-sm text-zinc-500">Comparing with GitHub…</p>
        )}

        {state.phase === "error" && (
          <p className="text-sm text-red-600">{state.message}</p>
        )}

        {state.phase === "no-base" && (
          <p className="text-sm text-zinc-600">
            No spec has been saved to <span className="font-medium">{branchLabel}</span> yet —
            your entire working copy is new. Save to create the first version.
          </p>
        )}

        {state.phase === "ready" && (
          <>
            {state.remoteAdvanced && (
              <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
                The branch on GitHub has new commits since you opened it — some changes
                below may be a collaborator's. Saving will diff against this tip.
              </p>
            )}
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-zinc-50 p-3 text-[12px] leading-relaxed text-zinc-800 ring-1 ring-zinc-200 whitespace-pre-wrap">
              {state.text}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
