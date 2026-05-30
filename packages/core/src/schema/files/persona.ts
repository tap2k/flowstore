import { Type, type Static } from "@sinclair/typebox";
import { MockBehaviorSchema } from "./mockBehavior";

// A persona is the user side of a conversation under test: optionally a
// system prompt driving LLM-as-user, plus the world that user lives in —
// the vars and per-capability mock returns that ground their identity
// (caller_name, policy_id, account_state, …). Persona-bound test cases
// inherit this world; scripted cases carry their own vars+mocks instead.
// system_prompt is optional so a persona can be "world-only" — bound by a
// scripted case purely for vars+mocks, with no LLM-as-user driver.
export const PersonaSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://test/persona/v0"),
    id: Type.String(),
    system_prompt: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    // Free-form {variable_name: value} dict — coerced against agent.variables
    // declarations at run time.
    vars: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    // Per-capability behaviors keyed by capability id. Caps not listed fall
    // through to the live capability (or {} if no live endpoint exists).
    mocks: Type.Optional(Type.Record(Type.String(), MockBehaviorSchema)),
  },
  { additionalProperties: false },
);

export type Persona = Static<typeof PersonaSchema>;
