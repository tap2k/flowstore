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
    // Language of the transcript. A gold is inherently in one language — you
    // don't translate a gold, you bless one per language. Cross-language
    // scenario identity comes from scenario_id, not from localized turns.
    language: Type.Optional(Type.String()),
    // Blessing metadata: when the customer approved this transcript as the
    // reference, and whether it came from a real conversation or was
    // authored/synthesized. Drift is measured against blessed golds only;
    // re-blessing (a new blessed_at) is the explicit baseline reset.
    blessed_at: Type.Optional(Type.String()),
    source_kind: Type.Optional(
      Type.Union([Type.Literal("transcript"), Type.Literal("authored")])
    ),
    // Shared scenario identity across language variants (and with test
    // cases). Language columns of a study join on this.
    scenario_id: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
    vars: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    mocks: Type.Optional(Type.Record(Type.String(), MockBehaviorSchema)),
    turns: Type.Array(GoldTurnSchema),
  },
  { additionalProperties: false },
);

export type GoldTurn = Static<typeof GoldTurnSchema>;
export type Gold = Static<typeof GoldSchema>;
