import { Type, type Static } from "@sinclair/typebox";

const GlossaryEntry = Type.Object(
  {
    id: Type.String(),
    term: Type.String(),
    definition: Type.String(),
  },
  { additionalProperties: false },
);

export const ProjectGlossaryFileSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://project-glossary/v0"),
    glossary: Type.Array(GlossaryEntry),
  },
  { additionalProperties: false },
);

export type ProjectGlossaryFile = Static<typeof ProjectGlossaryFileSchema>;
