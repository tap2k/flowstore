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
  setLoaded: (
    location: GithubProjectLocation,
    commitSha: string | null,
    canWrite?: boolean,
  ) => void;
  setCommitSha: (commitSha: string) => void;
  // Updates canWrite without touching location/sha — used by the save-time
  // 403 backstop when a write reveals the user is actually read-only here
  // (token-scope or permission change since open).
  setCanWrite: (canWrite: boolean) => void;
  clear: () => void;
}

interface PersistedShape {
  location: GithubProjectLocation | null;
  lastKnownCommitSha: string | null;
  canWrite: boolean;
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

function loadPersisted(): PersistedShape {
  if (typeof window === "undefined")
    return { location: null, lastKnownCommitSha: null, canWrite: true };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { location: null, lastKnownCommitSha: null, canWrite: true };
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (
      !parsed.location ||
      typeof parsed.location.owner !== "string" ||
      typeof parsed.location.repo !== "string" ||
      typeof parsed.location.ref !== "string"
    ) {
      return { location: null, lastKnownCommitSha: null, canWrite: true };
    }
    return {
      location: { owner: parsed.location.owner, repo: parsed.location.repo, ref: parsed.location.ref },
      lastKnownCommitSha: typeof parsed.lastKnownCommitSha === "string" ? parsed.lastKnownCommitSha : null,
      // Older entries (pre-canWrite) default to true — the save-time 403
      // catch corrects any optimism without losing the loaded project.
      canWrite: typeof parsed.canWrite === "boolean" ? parsed.canWrite : true,
    };
  } catch {
    return { location: null, lastKnownCommitSha: null, canWrite: true };
  }
}

const initial = loadPersisted();

export const useGithubProjectStore = create<GithubProjectState>((set) => ({
  location: initial.location,
  lastKnownCommitSha: initial.lastKnownCommitSha,
  canWrite: initial.canWrite,
  setLoaded: (location, commitSha, canWrite = true) => {
    persist({ location, lastKnownCommitSha: commitSha, canWrite });
    set({ location, lastKnownCommitSha: commitSha, canWrite });
  },
  setCommitSha: (commitSha) => {
    set((s) => {
      const next = { ...s, lastKnownCommitSha: commitSha };
      persist({
        location: next.location,
        lastKnownCommitSha: commitSha,
        canWrite: next.canWrite,
      });
      return next;
    });
  },
  setCanWrite: (canWrite) => {
    set((s) => {
      persist({ location: s.location, lastKnownCommitSha: s.lastKnownCommitSha, canWrite });
      return { ...s, canWrite };
    });
  },
  clear: () => {
    persist({ location: null, lastKnownCommitSha: null, canWrite: true });
    set({ location: null, lastKnownCommitSha: null, canWrite: true });
  },
}));
