import { Type, type Static } from "@sinclair/typebox";

// Two behaviors in v0; add `sequence` (returns from a list across calls)
// when a real spec asks for it. `static` returns a literal object; `error`
// raises a documented error string the script can surface.
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

// Mocks pair with capabilities by id, not path. Multiple variants per
// capability (`<id>.<variant>.mock.json`) let one test case pick a happy-path
// mock while another picks a failure mock. Filename convention is enforced
// by the loader, not by this schema.
export const CapabilityMockSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://capability-mock/v0"),
    capability_id: Type.String(),
    variant: Type.String(),
    description: Type.Optional(Type.String()),
    behavior: Type.Union([StaticBehavior, ErrorBehavior]),
  },
  { additionalProperties: false },
);

export type CapabilityMock = Static<typeof CapabilityMockSchema>;
