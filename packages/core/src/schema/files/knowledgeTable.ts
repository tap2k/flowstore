import { Type, type Static } from "@sinclair/typebox";

const TableField = Type.Object(
  {
    field: Type.String(),
    description: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

// Metadata sidecar for a knowledge table; rows live in the paired CSV.
// Loader validates structure + name + id; the CSV columns are validated
// against `structure[].field` at row-parse time in parseTableRowsCsv.
export const KnowledgeTableMetaSchema = Type.Object(
  {
    $schema: Type.Literal("uxflows://knowledge-table/v0"),
    id: Type.String(),
    name: Type.String(),
    purpose: Type.Optional(Type.String()),
    structure: Type.Array(TableField),
    scaling_rule: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type KnowledgeTableMeta = Static<typeof KnowledgeTableMetaSchema>;
