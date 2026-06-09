import { Type, type Static } from "@sinclair/typebox";

// Per-model entry. `name` is a human label; `endpoint` names which provider
// adapter dispatches calls — when absent, the loader infers from the model
// id prefix (gpt*/o* → openai, claude* → openai-compatible-via-openrouter,
// gemini* → google). `model_id` overrides the entry's key for the actual
// API call (e.g. an entry keyed "claude-sonnet" could carry the wire id
// "claude-sonnet-4-5"). additionalProperties: true lets projects carry
// forward-compatible extras (base_url, api_key_env per provider, vendor
// opts) without bumping the schema.
const ModelEntry = Type.Object(
  {
    name: Type.Optional(Type.String()),
    endpoint: Type.Optional(Type.String()),
    model_id: Type.Optional(Type.String()),
    // True for models that back the bidi audio (Live) API — the only
    // models the Simulation panel's voice mode can dispatch to. The voice
    // model picker filters on this. Today only Gemini Live qualifies.
    voice: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true },
);

// Roles are conventional but open-ended; agent/judge/user_simulation/authoring
// cover the MVP plan's named roles, additional roles allowed by extension.
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
    $schema: Type.Literal("flowstore://spec/models/v0"),
    models: Type.Optional(Type.Record(Type.String(), ModelEntry)),
    default: Type.Optional(Type.String()),
    roles: Type.Optional(ModelsRoles),
  },
  { additionalProperties: false },
);

export type ModelsFile = Static<typeof ModelsFileSchema>;
export type ModelEntry = Static<typeof ModelEntry>;
export type ModelsRoles = Static<typeof ModelsRoles>;
