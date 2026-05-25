import { validateFile, formatErrors } from "@flowstore/core/validation/ajv";
import {
  CommentSchema,
  anchorKey,
  type Comment,
  type CommentAnchor,
} from "@flowstore/core/schema/files/comment";
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

// Index keyed by serialized anchor (`<kind>/<id>`). Renderers do an O(1)
// lookup against the anchor they care about. Sorted oldest-first inside
// each bucket.
export function indexCommentsByAnchor(comments: Comment[]): Map<string, Comment[]> {
  const out = new Map<string, Comment[]>();
  for (const c of comments) {
    const key = anchorKey(c.anchor);
    const list = out.get(key) ?? [];
    list.push(c);
    out.set(key, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  return out;
}

// Convenience: fetch the bucket for a given anchor. Returns an empty array
// when no comments anchor here.
export function commentsForAnchor(
  index: Map<string, Comment[]>,
  anchor: CommentAnchor,
): Comment[] {
  return index.get(anchorKey(anchor)) ?? [];
}
