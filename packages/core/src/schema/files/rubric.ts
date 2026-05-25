import { Type, type Static } from "@sinclair/typebox";

// LLM-judge rubric: a criterion the judge model evaluates against the
// transcript. `prompt_template` supports {transcript}, {criteria},
// {gold_standard} placeholders — substituted at evaluation time by the
// testing scripts. `scale` carries the numeric range the judge returns;
// pass/fail thresholding lives in the script.
const Scale = Type.Object(
  {
    min: Type.Number(),
    max: Type.Number(),
  },
  { additionalProperties: false },
);

export const RubricSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://rubric/v0"),
    id: Type.String(),
    name: Type.Optional(Type.String()),
    criteria: Type.String(),
    scale: Scale,
    prompt_template: Type.String(),
    model: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type Rubric = Static<typeof RubricSchema>;
