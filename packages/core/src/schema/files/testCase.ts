import { Type, type Static } from "@sinclair/typebox";

// Per-capability mock binding for a test run: which mock variant should fire
// when the agent invokes capability X. Resolves to capabilities/<id>.<variant>.mock.json.
const MockBindings = Type.Record(Type.String(), Type.String());

// Lightweight per-turn substring assertion. `turn` is a 1-indexed pointer
// into the agent-only subsequence of the resulting transcript (turn 1 = the
// chatbot's opening when chatbot_initiates is true). Evaluation lives in
// the runner script; results land in result.evaluator_results[].
const Assertion = Type.Object(
  {
    turn: Type.Integer({ minimum: 1 }),
    must_contain: Type.Optional(Type.Array(Type.String())),
    must_not_contain: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

// Test case = scripted user turns + which evaluators run + how to mock
// capabilities for this run. Evaluator names resolve in both
// tests/evaluators/<name>.py and tests/rubrics/<name>.rubric.json — the
// loader picks whichever matches. Per-file `model` field pins the model for
// reproducibility; resolution chain is documented in FILE-MODEL.md.
export const TestCaseSchema = Type.Object(
  {
    $schema: Type.Literal("UX4://test-case/v0"),
    id: Type.String(),
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    user_turns: Type.Array(Type.String()),
    mock_bindings: Type.Optional(MockBindings),
    evaluators: Type.Optional(Type.Array(Type.String())),
    assertions: Type.Optional(Type.Array(Assertion)),
    persona_id: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type TestCase = Static<typeof TestCaseSchema>;
