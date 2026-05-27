import { Type, type Static } from "@sinclair/typebox";
import { VariableDeclSchema } from "@flowstore/core/schema/v0";

// Project-scope variable declarations, decomposed out of agent.json. File
// form at `variables.json`; directory form at `variables/<domain>.json`.
// A declaration enriches an already-referenced variable with type/description
// — it does not by itself create a variable (see SCHEMA.md § Variables).
export const VariablesFileSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://spec/variables/v0"),
    variables: Type.Record(Type.String(), VariableDeclSchema),
  },
  { additionalProperties: false },
);

export type VariablesFile = Static<typeof VariablesFileSchema>;
