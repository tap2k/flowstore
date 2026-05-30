import { Type, type Static } from "@sinclair/typebox";

// Per-capability mock behavior. `static` returns a literal object the call
// resolves to; `error` raises the documented error string the runner surfaces
// back to the model as a tool error. Used on personas (their world) and on
// scripted test cases / decision tests (when no persona supplies the world).
// `returns` is the object the capability call resolves to — a {output_name:
// value} dict matching the capability's declared outputs. Typed as a Record
// rather than Unknown so authoring errors (a bare string, a number) fail at
// load time instead of being silently dropped at run time.
const StaticBehavior = Type.Object(
  {
    kind: Type.Literal("static"),
    returns: Type.Record(Type.String(), Type.Unknown()),
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

export const MockBehaviorSchema = Type.Union([StaticBehavior, ErrorBehavior]);

export type MockBehavior = Static<typeof MockBehaviorSchema>;
