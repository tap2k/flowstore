import { Type, type Static } from "@sinclair/typebox";
import { MockBehaviorSchema } from "./mockBehavior";

// Per-turn assertion; `turn` indexes agent-only turns (1 = opening if chatbot_initiates).
// Evaluated in the runner; results in result.evaluator_results[].
const Assertion = Type.Object(
  {
    turn: Type.Integer({ minimum: 1 }),
    must_contain: Type.Optional(Type.Array(Type.String())),
    must_not_contain: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

// Cheap whole-transcript predicate (agent turns only). Complements per-turn assertions[]
// and rubrics. Operators: substring/regex (pattern match), count (occurrence range),
// must_terminate_within (turn limit). Required fields per kind enforced in runner, not schema.
const TranscriptAssertion = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("substring"),
      Type.Literal("regex"),
      Type.Literal("count"),
      Type.Literal("must_terminate_within"),
    ]),
    pattern: Type.Optional(Type.String()),
    must_appear: Type.Optional(Type.Boolean()),
    min_occurrences: Type.Optional(Type.Integer({ minimum: 0 })),
    max_occurrences: Type.Optional(Type.Integer({ minimum: 0 })),
    max_turns: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

// End-state assertion over result.final_variables. Exactly one of equals/matches/is_set
// must be provided — enforced in the runner (typebox can't express exactly-one-of cleanly).
// Only runner-path runs populate final_variables; prompt-mode runs fail loud.
const StateAssertion = Type.Object(
  {
    variable: Type.String(),
    equals: Type.Optional(Type.Unknown()),
    matches: Type.Optional(Type.String()),
    is_set: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

// Asserts whether a capability was invoked. `capability` is the capability id, not the
// runtime tool name. Evaluated on both prompt and runner targets. `invoked` defaults true.
const CapabilityAssertion = Type.Object(
  {
    capability: Type.String(),
    invoked: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

// Exactly one actor: user_turns (scripted), persona_id (reusable actor), or system_prompt
// (inline actor). Enforced in loader/runner, not schema. Fixture (vars + mocks) is
// situational; persona ∪ case, case wins. Evaluators resolve in tests/evaluators/ or
// tests/rubrics/; per-file `model` pins reproducibility (see FILE-MODEL.md).
// Plain text, or a barge-in object ({text, barge_in: true}) the --voice harness uses
// to truncate the agent's prior reply to what the caller heard before cutting in.
const ScriptedTurn = Type.Union([
  Type.String(),
  Type.Object(
    { text: Type.String(), barge_in: Type.Optional(Type.Boolean()) },
    { additionalProperties: false },
  ),
]);

export const TestCaseSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://test/case/v0"),
    id: Type.String(),
    name: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
    user_turns: Type.Optional(Type.Array(ScriptedTurn)),
    // Inline one-off simulated-user actor: drives LLM-as-user without a
    // reusable persona file. Mutually exclusive with user_turns / persona_id.
    system_prompt: Type.Optional(Type.String()),
    // Situational fixture merged over (overriding) the persona's. vars is a character
    // sheet — only provided-declared keys ship at run time (see VariableDeclSchema.provided).
    // mocks keyed by capability id, replacing the persona's mock per capability.
    vars: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    mocks: Type.Optional(Type.Record(Type.String(), MockBehaviorSchema)),
    evaluators: Type.Optional(Type.Array(Type.String())),
    assertions: Type.Optional(Type.Array(Assertion)),
    state_assertions: Type.Optional(Type.Array(StateAssertion)),
    transcript_assertions: Type.Optional(Type.Array(TranscriptAssertion)),
    capability_assertions: Type.Optional(Type.Array(CapabilityAssertion)),
    persona_id: Type.Optional(Type.String()),
    // Cap on persona-driven runs so a derailed conversation can't loop forever.
    // Ignored for scripted cases (user_turns is the implicit cap).
    max_turns: Type.Optional(Type.Integer({ minimum: 1 })),
    model: Type.Optional(Type.String()),
    // Language code for multilingual specs (e.g. "ES"). Required when spec declares >1 language;
    // runner fails loud rather than guessing.
    language: Type.Optional(Type.String()),
    // Suite-filter labels. Colon-namespace convention: "src:gold:<id>", "flow:<flow_id>", etc.
    // flow: tags are unvalidated annotation — not a coverage guarantee (stale silently on rename).
    // Bare tags for routing buckets ("negotiation", "after-grace"). Promote to field when earned.
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export type TestCase = Static<typeof TestCaseSchema>;
