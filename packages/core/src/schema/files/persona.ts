import { Type, type Static } from "@sinclair/typebox";

// Personas are minimal by design: just a user-side system prompt that drives
// LLM-as-user during exploration and (once captured) regression. Per-file
// `model` field lets a persona pin to a specific user-simulation model
// independently of the agent's model.
export const PersonaSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://test/persona/v0"),
    id: Type.String(),
    system_prompt: Type.String(),
    name: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    // Simulate-tab convenience: loading this persona offers to hydrate the
    // matching scenario (vars + mocks) so exploration starts in a coherent
    // world. NOT used by test cases — cases bind their own scenario_id for
    // reproducibility.
    default_scenario_id: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type Persona = Static<typeof PersonaSchema>;
