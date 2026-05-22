import { Type, type Static } from "@sinclair/typebox";

// Per-model entry. `name` is a human label; other fields are reserved for
// future expansion (model_id, endpoint, vendor opts) and live on the spec
// schema rather than this file's contract — additionalProperties: true lets
// projects carry forward-compatible extras without bumping the schema.
const ModelEntry = Type.Object(
  {
    name: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

// Roles are conventional but open-ended; agent/judge/user_simulation/authoring
// cover MVP-PLAN.md's named roles, additional roles allowed by extension.
const ModelsRoles = Type.Object(
  {
    agent: Type.Optional(Type.String()),
    judge: Type.Optional(Type.String()),
    user_simulation: Type.Optional(Type.String()),
    authoring: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

// Every models/*.json shares this shape; the loader unions providers/models
// maps across files and takes last-seen for scalar fields (default).
export const ModelsFileSchema = Type.Object(
  {
    $schema: Type.Literal("UX4://models/v0"),
    models: Type.Optional(Type.Record(Type.String(), ModelEntry)),
    default: Type.Optional(Type.String()),
    roles: Type.Optional(ModelsRoles),
  },
  { additionalProperties: false },
);

export type ModelsFile = Static<typeof ModelsFileSchema>;
export type ModelEntry = Static<typeof ModelEntry>;
export type ModelsRoles = Static<typeof ModelsRoles>;
