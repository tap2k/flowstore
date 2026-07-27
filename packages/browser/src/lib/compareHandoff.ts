import { loadProject } from "@flowstore/core/files";
import { buildStudyBundle } from "@flowstore/studies/bundle";
import { isStudyEmpty, loadStudy } from "@/compare/studyStorage";
import { loadPortableSpec } from "@/lib/store/loadSpec";

// Compare → editor graduation, receive side. Compare's "open in editor"
// navigates to /?study=compare after flushing the study to localStorage;
// both surfaces share an origin, so the study is simply read back out here
// and routed through the same bundle → loadProject → loadPortableSpec
// pipeline a file import uses — including its confirm-replace and
// drop-the-GitHub-claim policy (compare's stored repo location carries no
// commit SHA or permission info; re-opening the study repo via the GitHub
// modal does the real permission check). The flag (not unconditional
// import) is what keeps plain navigation to the editor from clobbering an
// open project with a stale study.
//
// Called from main.tsx at module scope: every store hydrates at
// module-creation time and App's startDirtyTracking runs post-mount, so a
// synchronous import here lands after hydration and inside the dirty
// baseline.
export function drainCompareHandoff(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get("study") !== "compare") return;

  // Strip the flag before importing — a refresh must re-open the editor's
  // own persisted project, not replay the import over subsequent edits.
  params.delete("study");
  const qs = params.toString();
  window.history.replaceState(
    null,
    "",
    window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
  );

  const study = loadStudy();
  if (isStudyEmpty(study)) return;

  const { spec, testingArtifacts, comments, modelsConfig, errors } = loadProject(
    buildStudyBundle(study),
  );
  if (!spec) {
    console.warn("compare handoff: study bundle failed to load", errors);
    return;
  }
  loadPortableSpec(spec, { testingArtifacts, comments, modelsConfig });
}
