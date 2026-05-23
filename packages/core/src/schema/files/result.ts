import { Type, type Static } from "@sinclair/typebox";

// What a testing script writes after one run of a test case. The editor's
// result viewer reads exactly this shape — the contract is load-bearing.
// final_variables is optional because not every script tracks a variable
// scope; state_check-style evaluation needs it, simpler scripts don't.
const TranscriptTurn = Type.Object(
  {
    role: Type.Union([
      Type.Literal("agent"),
      Type.Literal("user"),
      Type.Literal("system"),
    ]),
    content: Type.String(),
  },
  { additionalProperties: true },
);

const CapabilityCall = Type.Object(
  {
    capability: Type.String(),
    params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    result: Type.Optional(Type.Unknown()),
    error: Type.Optional(Type.String()),
    timestamp: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const EvaluatorResult = Type.Object(
  {
    name: Type.String(),
    passed: Type.Optional(Type.Boolean()),
    score: Type.Optional(Type.Number()),
    notes: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

// One element of `trials` for multi-trial runs. Mirrors the top-level result
// shape so suite aggregation can pass@k / pass^k over identical sub-shapes.
const Trial = Type.Object(
  {
    transcript: Type.Array(TranscriptTurn),
    capability_calls: Type.Optional(Type.Array(CapabilityCall)),
    final_variables: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    evaluator_results: Type.Optional(Type.Array(EvaluatorResult)),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export const ResultSchema = Type.Object(
  {
    $schema: Type.Literal("UX4://result/v0"),
    test_case_id: Type.String(),
    timestamp: Type.String(),
    agent_id: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    transcript: Type.Array(TranscriptTurn),
    capability_calls: Type.Optional(Type.Array(CapabilityCall)),
    final_variables: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    evaluator_results: Type.Optional(Type.Array(EvaluatorResult)),
    trials: Type.Optional(Type.Array(Trial)),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type Result = Static<typeof ResultSchema>;
