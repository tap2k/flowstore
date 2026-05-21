import { create } from "zustand";

export interface GithubProjectLocation {
  owner: string;
  repo: string;
  ref: string;
}

interface GithubProjectState {
  location: GithubProjectLocation | null;
  lastKnownCommitSha: string | null;
  setLoaded: (location: GithubProjectLocation, commitSha: string) => void;
  setCommitSha: (commitSha: string) => void;
  clear: () => void;
}

export const useGithubProjectStore = create<GithubProjectState>((set) => ({
  location: null,
  lastKnownCommitSha: null,
  setLoaded: (location, commitSha) => set({ location, lastKnownCommitSha: commitSha }),
  setCommitSha: (commitSha) => set({ lastKnownCommitSha: commitSha }),
  clear: () => set({ location: null, lastKnownCommitSha: null }),
}));
