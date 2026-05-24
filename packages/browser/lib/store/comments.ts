import { create } from "zustand";
import type { Comment } from "@ux4/core/schema/files/comment";
import { indexCommentsByFlow } from "@ux4/core/files";
import { postComment, locationFromParts } from "@/lib/comments/client";
import { useGithubProjectStore } from "./githubProject";
import { useSettingsStore } from "./settings";

interface CommentsState {
  comments: Comment[];
  // Derived from `comments`; recomputed on every mutation.
  commentsByFlow: Map<string, Comment[]>;

  // Replace the full list — used after project load/refresh.
  setAll: (comments: Comment[]) => void;

  // Author + persist a new comment anchored to a flow. Returns the new
  // comment on success; throws on network/auth failure (caller surfaces).
  createComment: (flowId: string, body: string) => Promise<Comment>;

  // Toggle resolved on an existing comment by id. Rewrites the same file
  // (UUID-keyed) with the new boolean.
  setResolved: (commentId: string, resolved: boolean) => Promise<void>;
}

function rebuildIndex(comments: Comment[]): Map<string, Comment[]> {
  return indexCommentsByFlow(comments);
}

function currentAuthor(): string {
  // Echoed from `GET /user` on PAT save (see settings.ts
  // fetchAndSetGithubIdentity). Falls back to "user" on the first comment
  // posted before the echo completes — extremely brief window in
  // practice.
  return useSettingsStore.getState().githubLogin || "user";
}

function nowIso(): string {
  return new Date().toISOString();
}

function newCommentId(): string {
  // crypto.randomUUID is available in modern browsers and Node 19+. Editor
  // is browser-only so this is safe. Prefix lets a human scan a directory
  // listing.
  const uuid = crypto.randomUUID();
  return `c-${uuid}`;
}

function getLocationOrThrow() {
  const loc = useGithubProjectStore.getState().location;
  const pat = useSettingsStore.getState().githubPat;
  if (!loc) throw new Error("Open a GitHub project before posting comments.");
  if (!pat) throw new Error("Add a GitHub PAT in Settings.");
  return locationFromParts(pat, loc.owner, loc.repo, loc.ref);
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  comments: [],
  commentsByFlow: new Map(),

  setAll: (comments) => {
    set({ comments, commentsByFlow: rebuildIndex(comments) });
  },

  createComment: async (flowId, body) => {
    const trimmed = body.trim();
    if (!trimmed) throw new Error("Comment body is empty.");
    const loc = getLocationOrThrow();
    const comment: Comment = {
      $schema: "UX4://comment/v0",
      id: newCommentId(),
      anchor: { kind: "flow", id: flowId },
      author: currentAuthor(),
      timestamp: nowIso(),
      body: trimmed,
      resolved: false,
    };
    const commitSha = await postComment(loc, comment, `Comment on ${flowId}`, "create");
    const next = [...get().comments, comment];
    set({ comments: next, commentsByFlow: rebuildIndex(next) });
    // Advance the project's known commit SHA so a subsequent spec save
    // doesn't trip ConflictError on a HEAD the editor itself moved.
    useGithubProjectStore.getState().setCommitSha(commitSha);
    return comment;
  },

  setResolved: async (commentId, resolved) => {
    const target = get().comments.find((c) => c.id === commentId);
    if (!target) throw new Error(`Comment ${commentId} not found.`);
    if (target.resolved === resolved) return;
    const loc = getLocationOrThrow();
    const updated: Comment = { ...target, resolved };
    const commitSha = await postComment(
      loc,
      updated,
      `${resolved ? "Resolve" : "Reopen"} comment on ${target.anchor.id}`,
      "update",
    );
    const next = get().comments.map((c) => (c.id === commentId ? updated : c));
    set({ comments: next, commentsByFlow: rebuildIndex(next) });
    useGithubProjectStore.getState().setCommitSha(commitSha);
  },
}));
