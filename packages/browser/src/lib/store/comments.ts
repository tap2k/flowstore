import { create } from "zustand";
import type { Comment, CommentAnchor } from "@uxflows/core/schema/files/comment";
import { anchorKey } from "@uxflows/core/schema/files/comment";
import { indexCommentsByAnchor } from "@uxflows/core/files";
import { postComment, locationFromParts } from "@/lib/comments/client";
import { useGithubProjectStore } from "./githubProject";
import { useSettingsStore } from "./settings";

interface CommentsState {
  comments: Comment[];
  // Derived from `comments`; recomputed on every mutation. Keyed by
  // `${kind}/${id}` so any future anchor surface (exit_path, capability,
  // guardrail, etc.) plugs in without touching the store.
  commentsByAnchor: Map<string, Comment[]>;

  // Replace the full list — used after project load/refresh.
  setAll: (comments: Comment[]) => void;

  // Author + persist a new comment anchored to any entity. Returns the
  // new comment on success; throws on network/auth failure.
  createComment: (anchor: CommentAnchor, body: string) => Promise<Comment>;

  // Toggle resolved on an existing comment by id. Rewrites the same file
  // (UUID-keyed) with the new boolean.
  setResolved: (commentId: string, resolved: boolean) => Promise<void>;
}

function rebuildIndex(comments: Comment[]): Map<string, Comment[]> {
  return indexCommentsByAnchor(comments);
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
  commentsByAnchor: new Map(),

  setAll: (comments) => {
    set({ comments, commentsByAnchor: rebuildIndex(comments) });
  },

  createComment: async (anchor, body) => {
    const trimmed = body.trim();
    if (!trimmed) throw new Error("Comment body is empty.");
    const loc = getLocationOrThrow();
    const comment: Comment = {
      $schema: "uxflows://comment/v0",
      id: newCommentId(),
      anchor,
      author: currentAuthor(),
      timestamp: nowIso(),
      body: trimmed,
      resolved: false,
    };
    const commitSha = await postComment(loc, comment, `Comment on ${anchorKey(anchor)}`, "create");
    const next = [...get().comments, comment];
    set({ comments: next, commentsByAnchor: rebuildIndex(next) });
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
      `${resolved ? "Resolve" : "Reopen"} comment on ${anchorKey(target.anchor)}`,
      "update",
    );
    const next = get().comments.map((c) => (c.id === commentId ? updated : c));
    set({ comments: next, commentsByAnchor: rebuildIndex(next) });
    useGithubProjectStore.getState().setCommitSha(commitSha);
  },
}));
