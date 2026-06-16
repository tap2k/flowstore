import { Type, type Static } from "@sinclair/typebox";
import { MockBehaviorSchema } from "./mockBehavior";

// A gold is a verbatim reference transcript — the canonical example of
// how a conversation should go. Independent artifact: not 1:1 with a test
// case (a single gold may seed many derived cases; a captured gold may
// have no case yet). Authored in two ways today: extracted from
// customer source material via prompts/GOLD-EXTRACTION-PROMPT.txt, or
// captured from a Simulate session in the editor. Run by `run_golds.py`
// which replays user turns and compares against the gold's agent turns.
export const GoldTurnSchema = Type.Object(
  {
    role: Type.Union([Type.Literal("agent"), Type.Literal("user")]),
    text: Type.String(),
  },
  { additionalProperties: false },
);

export const GoldSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://test/gold/v0"),
    id: Type.String(),
    name: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
    source_pointer: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
    vars: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    mocks: Type.Optional(Type.Record(Type.String(), MockBehaviorSchema)),
    turns: Type.Array(GoldTurnSchema),
  },
  { additionalProperties: false },
);

export type GoldTurn = Static<typeof GoldTurnSchema>;
export type Gold = Static<typeof GoldSchema>;
