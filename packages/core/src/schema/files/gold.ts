import { Type, type Static } from "@sinclair/typebox";

// A gold is a verbatim reference transcript — the canonical example of
// how a scenario should go. Independent artifact: not 1:1 with a test
// case (a single gold may seed many derived cases; a captured gold may
// have no case yet). Authored in two ways today: extracted from
// customer source material via prompts/GOLD-EXTRACTION-PROMPT.txt, or
// captured from a Simulate session in the editor. Consumed by the
// rubric judge (`outcome_matches_gold`) and as the source for
// `derive_cases.py`.
export const GoldTurnSchema = Type.Object(
  {
    role: Type.Union([Type.Literal("agent"), Type.Literal("user")]),
    text: Type.String(),
    // Optional free-form category tags (e.g. "Happy Path", "Sad Path") for
    // stress-test goldens classifying user-input rows. awaaz's
    // stress_test_* golds carry these; ignore if not present.
    properties: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const GoldSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://test/gold/v0"),
    id: Type.String(),
    name: Type.String(),
    scenario: Type.String(),
    turns: Type.Array(GoldTurnSchema),
    source_pointer: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type GoldTurn = Static<typeof GoldTurnSchema>;
export type Gold = Static<typeof GoldSchema>;
