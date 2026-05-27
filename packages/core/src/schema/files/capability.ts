import { Type, type Static } from "@sinclair/typebox";
import { CapabilitySchema } from "@flowstore/core/schema/v0";

// A single capability declaration, decomposed out of agent.json into
// `capabilities/<id>.capability.json` (directory form — one declaration per
// file, paired with `<id>.<variant>.mock.json` test mocks by id). Endpoints,
// headers, and credentials live in the execution layer, never here.
export const CapabilityFileSchema = Type.Composite(
  [
    Type.Object({ $schema: Type.Literal("flowstore://spec/capability/v0") }),
    CapabilitySchema,
  ],
  { additionalProperties: false },
);

export type CapabilityFile = Static<typeof CapabilityFileSchema>;
