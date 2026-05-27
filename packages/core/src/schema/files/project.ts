import { Type, type Static } from "@sinclair/typebox";

export const ProjectManifestSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://spec/project/v0"),
  },
  { additionalProperties: false },
);

export type ProjectManifest = Static<typeof ProjectManifestSchema>;
