import { validateFile, formatErrors } from "@ux4/core/validation/ajv";
import { CommentSchema, type Comment } from "@ux4/core/schema/files/comment";
import type { FileMap, LoadError } from "./types";

const COMMENT_RE = /^comments\/(.+)\.comment\.json$/;

export function loadComments(files: FileMap, errors: LoadError[]): Comment[] {
  const out: Comment[] = [];
  const paths = Object.keys(files).filter((p) => COMMENT_RE.test(p)).sort();
  for (const path of paths) {
    let parsed: Comment;
    try {
      parsed = JSON.parse(files[path]) as Comment;
    } catch (e) {
      errors.push({ path, message: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const check = validateFile(CommentSchema, parsed);
    if (!check.valid) {
      for (const msg of formatErrors(check.errors)) {
        errors.push({ path, message: msg });
      }
      continue;
    }
    out.push(parsed);
  }
  return out;
}

// Path the writer puts a new comment at. UUID-keyed; collisions are
// impossible in practice.
export function commentPath(comment: Comment): string {
  return `comments/${comment.id}.comment.json`;
}

// Index by flow id so a renderer can look up "comments on this flow" in
// O(1). The current schema only supports `anchor.kind === "flow"`; when
// more anchor kinds land, broaden this helper or add a generic
// `commentsByAnchor` index.
export function indexCommentsByFlow(comments: Comment[]): Map<string, Comment[]> {
  const out = new Map<string, Comment[]>();
  for (const c of comments) {
    if (c.anchor.kind !== "flow") continue;
    const list = out.get(c.anchor.id) ?? [];
    list.push(c);
    out.set(c.anchor.id, list);
  }
  // Stable sort: oldest first inside each flow.
  for (const list of out.values()) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  return out;
}
