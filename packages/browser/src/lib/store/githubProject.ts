import { create } from "zustand";

const STORAGE_KEY = "flowstore:github_project";

export interface GithubProjectLocation {
  owner: string;
  repo: string;
  ref: string;
}

interface GithubProjectState {
  location: GithubProjectLocation | null;
  // null when the loaded ref has no commits yet (fresh repo just initialized
  // in the editor). First Save creates the commit and the SHA gets recorded.
  lastKnownCommitSha: string | null;
  // True for repos the user can push to (owner, write/maintain/admin role).
  // False for read-only collaborator / public read access. Drives the
  // subtitle "read-only" badge and re-routes the cloud Save icon to
  // "Save a copy". Token-scope read-only (write role but a Contents:read
  // PAT) still trips the save-time 403 backstop in GitHubProjectControls.
  canWrite: boolean;
  // True only for owners/admins — managing collaborators (the Share modal)
  // requires admin on GitHub's side; push/maintain isn't enough. Gates the
  // Share button so write-only collaborators don't see an affordance that
  // 403s on every operation.
  canAdmin: boolean;
  // -----------------------------------------------------------------------
  // pendingForceSave — first-save hack for brand-new repos.
  // -----------------------------------------------------------------------
  // True for exactly one save following save-to-new-repo. The mechanism:
  //
  // Account-installed GitHub Apps (security scanners, CODEOWNERS bots,
  // default-CI installers, etc.) and in some cases GitHub's own deferred
  // finalization of the initial commit will push — and, observed in
  // practice, sometimes *force-push* — commits onto a brand-new repo
  // asynchronously, advancing or outright reverting HEAD past what our
  // save-to-new-repo just recorded. We can't reason this away from
  // outside; polling getRef/getReadme/etc. doesn't help because the drift
  // can land after our write returns.
  //
  // A real collaborator conflict is impossible on a repo this fresh, so
  // the next save:
  //   1. Skips the expectedCommitSha check in GitHubProjectControls.doSave
  //      (no spurious "Someone else saved changes" modal).
  //   2. Passes `force: true` to updateRef in writeFileMapToRepo so the
  //      ref can be moved non-fast-forward.
  // Both are required — without (2), the integration can still race us
  // inside a single writeFileMapToRepo call (between getRef and updateRef)
  // and surface a 422 instead of a phantom conflict.
  //
  // Single-shot: clears on the next successful save; subsequent saves
  // resume normal optimistic concurrency, so genuine collaborator
  // conflicts on the same repo still surface correctly.
  //
  // Side effect — orphan commit. When the integration force-pushes back
  // over our SaveToNewRepoModal write, our "Initial commit from
  // flowstore" commit becomes unreachable from `main` (still in git's
  // object store, recoverable via reflog). The user's first edit-save
  // then commits their full spec on top of whatever HEAD currently is,
  // overlaying via base_tree, so no content is lost. Visible history is
  // typically "Initialize repository" → "Update spec from flowstore
  // editor" — 2 commits, not 3. Functionally clean; documented here so
  // it isn't mistaken for a bug.
  pendingForceSave: boolean;
  setLoaded: (
    location: GithubProjectLocation,
    commitSha: string | null,
    canWrite?: boolean,
    canAdmin?: boolean,
  ) => void;
  setCommitSha: (commitSha: string) => void;
  // Updates canWrite without touching location/sha — used by the save-time
  // 403 backstop when a write reveals the user is actually read-only here
  // (token-scope or permission change since open).
  setCanWrite: (canWrite: boolean) => void;
  // Updates canAdmin without touching location/sha — used by the share-time
  // 403 backstop (collaborator write succeeds but addCollaborator 403s).
  setCanAdmin: (canAdmin: boolean) => void;
  setPendingForceSave: (b: boolean) => void;
  clear: () => void;
}

interface PersistedShape {
  location: GithubProjectLocation | null;
  lastKnownCommitSha: string | null;
  canWrite: boolean;
  canAdmin: boolean;
  pendingForceSave: boolean;
}

function persist(state: PersistedShape): void {
  if (typeof window === "undefined") return;
  try {
    if (state.location === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function emptyPersisted(): PersistedShape {
  return {
    location: null,
    lastKnownCommitSha: null,
    canWrite: true,
    canAdmin: true,
    pendingForceSave: false,
  };
}

function loadPersisted(): PersistedShape {
  if (typeof window === "undefined") return emptyPersisted();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPersisted();
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (
      !parsed.location ||
      typeof parsed.location.owner !== "string" ||
      typeof parsed.location.repo !== "string" ||
      typeof parsed.location.ref !== "string"
    ) {
      return emptyPersisted();
    }
    return {
      location: { owner: parsed.location.owner, repo: parsed.location.repo, ref: parsed.location.ref },
      lastKnownCommitSha: typeof parsed.lastKnownCommitSha === "string" ? parsed.lastKnownCommitSha : null,
      // Older entries (pre-canWrite) default to true — the save-time 403
      // catch corrects any optimism without losing the loaded project.
      canWrite: typeof parsed.canWrite === "boolean" ? parsed.canWrite : true,
      // Older entries (pre-canAdmin) default to true so admins don't lose
      // Share after upgrade until they reopen the project; a 403 from any
      // collaborator-write op flips it false (setCanAdmin), matching the
      // canWrite backstop pattern.
      canAdmin: typeof parsed.canAdmin === "boolean" ? parsed.canAdmin : true,
      // Survives a refresh between save-to-new-repo and the user's first
      // real save, so the conflict-check bypass still applies after reload.
      pendingForceSave: typeof parsed.pendingForceSave === "boolean" ? parsed.pendingForceSave : false,
    };
  } catch {
    return emptyPersisted();
  }
}

const initial = loadPersisted();

export const useGithubProjectStore = create<GithubProjectState>((set) => ({
  location: initial.location,
  lastKnownCommitSha: initial.lastKnownCommitSha,
  canWrite: initial.canWrite,
  canAdmin: initial.canAdmin,
  pendingForceSave: initial.pendingForceSave,
  setLoaded: (location, commitSha, canWrite = true, canAdmin = true) => {
    // setLoaded resets pendingForceSave by default — fresh project means
    // the flag's history doesn't apply. SaveToNewRepoModal then turns it
    // on explicitly via setPendingForceSave(true).
    persist({
      location,
      lastKnownCommitSha: commitSha,
      canWrite,
      canAdmin,
      pendingForceSave: false,
    });
    set({
      location,
      lastKnownCommitSha: commitSha,
      canWrite,
      canAdmin,
      pendingForceSave: false,
    });
  },
  setCommitSha: (commitSha) => {
    set((s) => {
      const next = { ...s, lastKnownCommitSha: commitSha };
      persist({
        location: next.location,
        lastKnownCommitSha: commitSha,
        canWrite: next.canWrite,
        canAdmin: next.canAdmin,
        pendingForceSave: next.pendingForceSave,
      });
      return next;
    });
  },
  setCanWrite: (canWrite) => {
    set((s) => {
      persist({
        location: s.location,
        lastKnownCommitSha: s.lastKnownCommitSha,
        canWrite,
        canAdmin: s.canAdmin,
        pendingForceSave: s.pendingForceSave,
      });
      return { ...s, canWrite };
    });
  },
  setCanAdmin: (canAdmin) => {
    set((s) => {
      persist({
        location: s.location,
        lastKnownCommitSha: s.lastKnownCommitSha,
        canWrite: s.canWrite,
        canAdmin,
        pendingForceSave: s.pendingForceSave,
      });
      return { ...s, canAdmin };
    });
  },
  setPendingForceSave: (pendingForceSave) => {
    set((s) => {
      persist({
        location: s.location,
        lastKnownCommitSha: s.lastKnownCommitSha,
        canWrite: s.canWrite,
        canAdmin: s.canAdmin,
        pendingForceSave,
      });
      return { ...s, pendingForceSave };
    });
  },
  clear: () => {
    persist(emptyPersisted());
    set(emptyPersisted());
  },
}));
