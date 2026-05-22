import { create } from "zustand";

const STORAGE_KEY = "uxflows:github_project";

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
  setLoaded: (location: GithubProjectLocation, commitSha: string | null) => void;
  setCommitSha: (commitSha: string) => void;
  clear: () => void;
}

interface PersistedShape {
  location: GithubProjectLocation | null;
  lastKnownCommitSha: string | null;
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
  if (typeof window === "undefined") return { location: null, lastKnownCommitSha: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { location: null, lastKnownCommitSha: null };
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (
      !parsed.location ||
      typeof parsed.location.owner !== "string" ||
      typeof parsed.location.repo !== "string" ||
      typeof parsed.location.ref !== "string"
    ) {
      return { location: null, lastKnownCommitSha: null };
    }
    return {
      location: { owner: parsed.location.owner, repo: parsed.location.repo, ref: parsed.location.ref },
      lastKnownCommitSha: typeof parsed.lastKnownCommitSha === "string" ? parsed.lastKnownCommitSha : null,
    };
  } catch {
    return { location: null, lastKnownCommitSha: null };
  }
}

const initial = loadPersisted();

export const useGithubProjectStore = create<GithubProjectState>((set) => ({
  location: initial.location,
  lastKnownCommitSha: initial.lastKnownCommitSha,
  setLoaded: (location, commitSha) => {
    persist({ location, lastKnownCommitSha: commitSha });
    set({ location, lastKnownCommitSha: commitSha });
  },
  setCommitSha: (commitSha) => {
    set((s) => {
      const next = { ...s, lastKnownCommitSha: commitSha };
      persist({ location: next.location, lastKnownCommitSha: commitSha });
      return next;
    });
  },
  clear: () => {
    persist({ location: null, lastKnownCommitSha: null });
    set({ location: null, lastKnownCommitSha: null });
  },
}));
