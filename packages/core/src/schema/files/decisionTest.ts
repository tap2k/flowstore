import { Type, type Static } from "@sinclair/typebox";

// Per-capability mock binding — same shape as test-case/v0; decision tests
// may need mocks if the prefix or any branch exercises a capability call.
const MockBindings = Type.Record(Type.String(), Type.String());

// One branch of a decision test: "given the prefix-state, what does the
// agent do when the user says <user_input>?". Substring assertions are
// the v0 verdict mechanism. `expected_class` is informational (route /
// flow / intent label the author expected) — not asserted by v0 runners
// but useful for downstream filtering and reporting.
const DecisionBranch = Type.Object(
  {
    user_input: Type.String(),
    expected_class: Type.Optional(Type.String()),
    must_contain: Type.Optional(Type.Array(Type.String())),
    must_not_contain: Type.Optional(Type.Array(Type.String())),
    notes: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

// flowstore://test/decision-test/v0
//
// A decision test pins one point in a conversation (the prefix) and asks
// many candidate user inputs in parallel: "does the agent route /
// respond correctly for each variant?" Cost-per-assertion is much lower
// than full conversation tests because the prefix is shared.
//
// Maps 1:1 to flow.exit_paths[].condition — each exit condition is a
// classifier worth testing against many inputs. See
// docs/testing-plan.md → "Three units of testing → Decision tests".
//
// Authoring shape:
//   - prefix_turns[] is user inputs that get the conversation to the
//     state under test. The opening agent turn (when chatbot_initiates)
//     is implicit.
//   - branches[] is the matrix to test at that point.
//   - assertions are per-branch (must_contain / must_not_contain). No
//     per-turn / state / transcript assertions in v0 — decision tests
//     are scoped to "the agent's immediate response to the branch input".
//
// Execution: v0 runners replay the prefix once per branch as fresh
// sessions. Cost is len(prefix) * len(branches) LLM calls vs the ideal
// len(prefix) + len(branches); acceptable until decision tests get
// numerous enough to warrant session forking on the runner side.
export const DecisionTestSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://test/decision-test/v0"),
    id: Type.String(),
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    prefix_turns: Type.Array(Type.String()),
    branches: Type.Array(DecisionBranch),
    mock_bindings: Type.Optional(MockBindings),
    model: Type.Optional(Type.String()),
    language: Type.Optional(Type.String()),
    vars_file: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export type DecisionTest = Static<typeof DecisionTestSchema>;
