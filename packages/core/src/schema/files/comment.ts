import { Type, type Static } from "@sinclair/typebox";

// Comments are additive per-uuid files at `comments/<uuid>.comment.json`.
// Two writers never conflict because they write distinct files; resolution
// flips `resolved: true` on the original file. Threading is flat in v1 —
// all comments on the same anchor are siblings sorted by timestamp.
//
// Anchor `kind` covers every entity FILE-MODEL.md may need a comment
// thread on. Editor only surfaces flow comments today; the broader enum
// lives in the schema so existing comment files keep validating as more
// surfaces wire up. `exit_path` anchors carry both the parent flow id
// and the exit path id (`<flow_id>::<exit_path_id>`); other kinds use the
// entity's bare id.
export const COMMENT_ANCHOR_KINDS = [
  "flow",
  "exit_path",
  "capability",
  "guardrail",
  "business_goal",
  "variable",
  "faq",
  "glossary",
  "table",
  "persona",
  "rubric",
  "evaluator",
  "test_case",
  "mock",
] as const;

const CommentAnchor = Type.Object(
  {
    kind: Type.Union(COMMENT_ANCHOR_KINDS.map((k) => Type.Literal(k))),
    id: Type.String(),
  },
  { additionalProperties: false },
);

export const CommentSchema = Type.Object(
  {
    $schema: Type.Literal("uxflows://comment/v0"),
    id: Type.String(),
    anchor: CommentAnchor,
    author: Type.String(),
    timestamp: Type.String(), // ISO-8601 UTC
    body: Type.String(),
    resolved: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type Comment = Static<typeof CommentSchema>;
export type CommentAnchor = Static<typeof CommentAnchor>;
export type CommentAnchorKind = (typeof COMMENT_ANCHOR_KINDS)[number];

// Stable serialized key for indexing. Convention used by store + UI.
export function anchorKey(anchor: CommentAnchor): string {
  return `${anchor.kind}/${anchor.id}`;
}
