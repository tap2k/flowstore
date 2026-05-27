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

// Test case = scripted user turns OR a persona-driven conversation + which
// evaluators run + how to mock capabilities. Two shapes share this file type
// because both are discovered the same way; the runner script branches on
// presence of persona_id. Cases must carry one of user_turns or persona_id
// (enforced in the runner, not the schema).
//
// Evaluator names resolve in both tests/evaluators/<name>.py and
// tests/rubrics/<name>.rubric.json — the loader picks whichever matches.
// Per-file `model` field pins the model for reproducibility; resolution chain
// is documented in FILE-MODEL.md.
export const TestCaseSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://test/case/v0"),
    id: Type.String(),
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    user_turns: Type.Optional(Type.Array(Type.String())),
    mock_bindings: Type.Optional(MockBindings),
    evaluators: Type.Optional(Type.Array(Type.String())),
    assertions: Type.Optional(Type.Array(Assertion)),
    persona_id: Type.Optional(Type.String()),
    // Cap on persona-driven runs so a derailed conversation can't loop forever.
    // Ignored for scripted cases (user_turns is the implicit cap).
    max_turns: Type.Optional(Type.Integer({ minimum: 1 })),
    // Reference to tests/gold/<gold_id>.gold.json — consumed by gold-comparing
    // rubrics (the {gold_standard} placeholder in rubric.prompt_template).
    gold_id: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    // Language code (e.g. "ES", "EN") for multilingual specs. Required when
    // spec.meta.languages declares >1 language; the runner script fails loud
    // if absent rather than guessing the first declared language.
    language: Type.Optional(Type.String()),
    // Path (project-relative) to a JSON file of {placeholder: value} to inject
    // into the compiled prompt for this case. Makes the case self-describing —
    // suite runners can pick up the right variable bundle without out-of-band
    // mapping. CLI --vars-file still wins when explicitly passed.
    vars_file: Type.Optional(Type.String()),
    // Free-form labels for suite filtering and grouping. Suite runners accept
    // a `--tag <name>` filter that includes only cases carrying that tag.
    // Colon-prefixed namespaces are the lightweight convention for richer
    // metadata: "src:gold:<id>" / "src:session:<id>" / "src:bug:<id>" /
    // "src:authored" for provenance; bare tags for routing buckets
    // ("negotiation", "after-grace", "wrong-number"). Promote a convention
    // to a structured field only when a consumer earns it.
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export type TestCase = Static<typeof TestCaseSchema>;
