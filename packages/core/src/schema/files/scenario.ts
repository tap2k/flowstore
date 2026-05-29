import { Type, type Static } from "@sinclair/typebox";

// A scenario is the "world" the agent runs in: the user's situation (vars)
// plus what each capability returns when called (mocks). Both inline — no
// further indirection through vars files or per-cap variant files. Scenarios
// are the unit a test case binds to, and the unit a persona may default to
// for Simulate-tab exploration. Reusable across cases and personas.

// Mock behavior per capability. `static` returns a literal object the call
// resolves to; `error` raises the documented error string the runner surfaces
// back to the model as a tool error.
const StaticBehavior = Type.Object(
  {
    kind: Type.Literal("static"),
    returns: Type.Unknown(),
  },
  { additionalProperties: false },
);

const ErrorBehavior = Type.Object(
  {
    kind: Type.Literal("error"),
    error: Type.String(),
  },
  { additionalProperties: false },
);

export const ScenarioMockBehaviorSchema = Type.Union([StaticBehavior, ErrorBehavior]);

export const ScenarioSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://test/scenario/v0"),
    id: Type.String(),
    name: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
    // Free-form {variable_name: value} dict — coerced against agent.variables
    // declarations at run time, same as today's vars files were.
    vars: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    // Per-capability behaviors keyed by capability id. Caps not listed fall
    // through to the live capability (or {} if no live endpoint exists).
    mocks: Type.Optional(Type.Record(Type.String(), ScenarioMockBehaviorSchema)),
  },
  { additionalProperties: false },
);

export type Scenario = Static<typeof ScenarioSchema>;
export type ScenarioMockBehavior = Static<typeof ScenarioMockBehaviorSchema>;
