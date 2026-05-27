import { Type, type Static } from "@sinclair/typebox";
import { BusinessGoalSchema } from "@flowstore/core/schema/v0";

// Project-scope business goals, decomposed out of agent.json. File form at
// `business-goals.json`; directory form at `business-goals/<track>.json`.
export const BusinessGoalsFileSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://spec/business-goals/v0"),
    business_goals: Type.Array(BusinessGoalSchema),
  },
  { additionalProperties: false },
);

export type BusinessGoalsFile = Static<typeof BusinessGoalsFileSchema>;
