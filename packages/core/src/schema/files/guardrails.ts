import { Type, type Static } from "@sinclair/typebox";
import { GuardrailSchema } from "@flowstore/core/schema/v0";

// Project-scope guardrails, decomposed out of agent.json. File form lives at
// `guardrails.json`; directory form at `guardrails/<concern>.json` (same
// wrapper shape per file). The loader merges both into agent.guardrails.
export const GuardrailsFileSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://spec/guardrails/v0"),
    guardrails: Type.Array(GuardrailSchema),
  },
  { additionalProperties: false },
);

export type GuardrailsFile = Static<typeof GuardrailsFileSchema>;
