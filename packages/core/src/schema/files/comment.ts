import { Type, type Static } from "@sinclair/typebox";

// Comments are additive per-uuid files at `comments/<uuid>.comment.json`.
// Two writers never conflict because they write distinct files; resolution
// flips `resolved: true` on the original file. Threading is flat in v1 —
// all comments on the same anchor are siblings sorted by timestamp.
// Anchor kinds beyond flow are intentionally not modeled yet; broaden the
// enum when designers ask for it.
const CommentAnchor = Type.Object(
  {
    kind: Type.Literal("flow"),
    id: Type.String(),
  },
  { additionalProperties: false },
);

export const CommentSchema = Type.Object(
  {
    $schema: Type.Literal("UX4://comment/v0"),
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
export type CommentAnchorKind = Static<typeof CommentAnchor>["kind"];
