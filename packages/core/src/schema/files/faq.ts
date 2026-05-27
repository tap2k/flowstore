import { Type, type Static } from "@sinclair/typebox";
import { FaqEntrySchema } from "@flowstore/core/schema/v0";

// Project-scope FAQ, decomposed out of agent.json into knowledge/faq.json
// (file form) or knowledge/faq/<topic>.json (directory form). Answers are
// LocalizedString (plain string monolingual, or { <lang>: string } map).
export const FaqFileSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://spec/faq/v0"),
    faq: Type.Array(FaqEntrySchema),
  },
  { additionalProperties: false },
);

export type FaqFile = Static<typeof FaqFileSchema>;
