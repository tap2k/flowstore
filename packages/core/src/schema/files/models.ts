import { Type, type Static } from "@sinclair/typebox";

// Per-model entry. `name` is a human label; `endpoint` names which provider
// adapter dispatches calls — when absent, the loader infers from the model
// id prefix (gpt*/o* → openai, claude* → openai-compatible-via-openrouter,
// gemini* → google). `model_id` overrides the entry's key for the actual
// API call (e.g. an entry keyed "claude-sonnet" could carry the wire id
// "claude-sonnet-4-5"). `base_url` is used with `endpoint: openai-compatible`
// to target a self-hosted or staging inference server (Ollama, vLLM, etc.).
// `api_key` supplies the bearer token for that server; omit for keyless servers.
const ModelEntry = Type.Object(
  {
    name: Type.Optional(Type.String()),
    endpoint: Type.Optional(Type.String()),
    model_id: Type.Optional(Type.String()),
    base_url: Type.Optional(Type.String()),
    api_key: Type.Optional(Type.String()),
    // True for models that back the bidi audio (Live) API — the only
    // models the Simulation panel's voice mode can dispatch to. The voice
    // model picker filters on this. Today only Gemini Live qualifies.
    voice: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true },
);

// Live HTTP endpoint for a named capability. When configured, simulation
// POSTs the LLM's tool-call args to `url` as JSON and uses the response
// body as the capability result instead of the static mock.
const CapabilityEndpoint = Type.Object(
  {
    url: Type.String(),
    method: Type.Optional(Type.Union([
      Type.Literal("GET"),
      Type.Literal("POST"),
      Type.Literal("PUT"),
      Type.Literal("PATCH"),
    ])),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  },
  { additionalProperties: false },
);

// External agent endpoint — an opaque HTTP conversational agent that flowstore
// drives by sending user turns and receiving agent replies. The agent handles
// its own inference; flowstore only manages the conversation loop and evaluation.
//
// URL and body templates support {{session_id}} and {{input}} substitution.
// response_text_path extracts the reply text from the JSON response using
// dot-notation (e.g. "text", "data.message", "choices.0.content").
// ended_path (optional) extracts a boolean from the response that signals
// the session has ended (e.g. "endInteraction").
// session_id strategy: "uuid" = generate a UUID client-side (default).
const AgentEndpoint = Type.Object(
  {
    name: Type.Optional(Type.String()),
    turn_url: Type.String(),
    turn_method: Type.Optional(Type.Union([
      Type.Literal("GET"),
      Type.Literal("POST"),
      Type.Literal("PUT"),
      Type.Literal("PATCH"),
    ])),
    turn_body: Type.Optional(Type.Unknown()),
    turn_headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    response_text_path: Type.String(),
    ended_path: Type.Optional(Type.String()),
    session_id: Type.Optional(Type.Literal("uuid")),
  },
  { additionalProperties: false },
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
    // Per-capability live HTTP endpoints. Key is the capability name (same
    // key as mock_returns). When set, simulation calls the real endpoint
    // instead of returning the static mock.
    capabilities: Type.Optional(Type.Record(Type.String(), CapabilityEndpoint)),
    // Named external agent endpoints. When one is selected in the simulate
    // panel, flowstore sends user turns to it instead of calling an LLM.
    agents: Type.Optional(Type.Record(Type.String(), AgentEndpoint)),
  },
  { additionalProperties: false },
);

export type ModelsFile = Static<typeof ModelsFileSchema>;
export type ModelEntry = Static<typeof ModelEntry>;
export type ModelsRoles = Static<typeof ModelsRoles>;
export type CapabilityEndpoint = Static<typeof CapabilityEndpoint>;
export type AgentEndpoint = Static<typeof AgentEndpoint>;
