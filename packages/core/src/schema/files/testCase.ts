import { Type, type Static } from "@sinclair/typebox";
import { MockBehaviorSchema } from "./mockBehavior";

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

// Cheap-predicate assertion over the WHOLE transcript (agent turns
// only). Complements per-turn `assertions[]` (which can miss leaks
// that happen on an unwatched turn) and rubrics (which are expensive
// and non-deterministic). Operators (kind):
//   substring             — pattern appears (must_appear true) or doesn't
//                           (must_appear false) somewhere in the agent
//                           transcript; case-insensitive
//   regex                 — same but pattern is a regex; case-sensitive
//                           by default (use (?i) for case-insensitive)
//   count                 — substring count (case-insensitive) falls in
//                           [min_occurrences, max_occurrences]; either
//                           bound is optional
//   must_terminate_within — agent emitted at most max_turns turns
//                           (catches runaway / infinite loops in
//                           persona-driven runs)
// must_appear defaults to true. Required fields per kind enforced in
// the runner, not the schema.
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

// End-state assertion over result.final_variables. One assertion per
// {variable} check. Exactly one of equals / matches / is_set must be
// provided — enforced in the runner script, not in the schema (typebox
// can't express exactly-one-of cleanly across heterogeneous operand
// types). Semantics:
//   equals  — strict equality (Python ==) against the bound value
//   matches — regex against str(value); useful for opaque ids like "claim_abc123"
//   is_set  — true: variable must be bound to any non-None value;
//             false: variable must be absent or bound to None
// Only the runner path populates final_variables today; state_assertions[]
// against a system-prompt run fail loud rather than silently pass.
const StateAssertion = Type.Object(
  {
    variable: Type.String(),
    equals: Type.Optional(Type.Unknown()),
    matches: Type.Optional(Type.String()),
    is_set: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

// Deterministic assertion over result.capability_calls[]: did the agent invoke
// a given capability? This is the direct check authors previously had to fake
// with a transcript_assertion on whatever string a mock's return value leaked
// into the agent's prose (brittle, and silent when the agent paraphrases).
//   invoked true  — capability fired at least once
//   invoked false — capability never fired (e.g. no claim filed mid-emergency)
// `capability` is the capability id (matches CapabilityCall.capability), not the
// runtime tool name. Unlike state_assertions, capability_calls is populated on
// BOTH the compiled-prompt and runner targets (the prompt harness dispatches
// mocks itself, the runner reports them), so these evaluate on either path.
// `invoked` defaults true. Count / params-subset checks are deliberately
// omitted until a case needs them.
const CapabilityAssertion = Type.Object(
  {
    capability: Type.String(),
    invoked: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

// Test case = how the conversation is driven (the ACTOR) + which evaluators
// run + the SITUATIONAL fixture for this scenario. Exactly one actor:
//   - user_turns       — scripted: the runner feeds these verbatim
//   - persona_id        — simulated user, a referenced reusable actor
//   - system_prompt     — simulated user, an inline one-off actor
// Enforced in the loader/runner, not the schema (typebox can't express
// exactly-one-of cleanly). A scripted case never binds a persona just for its
// fixture — it carries the fixture inline instead.
//
// Fixture (vars + mocks) is SITUATIONAL — the mock and the assertion it
// justifies are one thought, so they live together on the case. When a
// persona actor is bound, the effective fixture is `persona ∪ case`: vars
// merge per key, mocks replace per capability id, the case always winning.
//
// Evaluator names resolve in both tests/evaluators/<name>.py and
// tests/rubrics/<name>.rubric.json — the loader picks whichever matches.
// Per-file `model` field pins the model for reproducibility; resolution chain
// is documented in FILE-MODEL.md.
// A scripted user turn: plain text, or a voice barge-in turn — the
// interruption text plus a flag the --voice harness reads to truncate the
// agent's prior reply to what the caller "heard" before cutting in. Most
// turns are plain strings.
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
    // Situational fixture for this scenario, merged over (and overriding) the
    // bound persona's intrinsic fixture. vars: free-form {name: value} dict
    // coerced against agent.variables. mocks: per-capability behavior keyed by
    // capability id, replacing the persona's mock for that capability.
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
    // Reference to tests/gold/<gold_id>.gold.json — consumed by gold-comparing
    // rubrics (the {gold_standard} placeholder in rubric.prompt_template).
    gold_id: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    // Language code (e.g. "ES", "EN") for multilingual specs. Required when
    // spec.meta.languages declares >1 language; the runner script fails loud
    // if absent rather than guessing the first declared language.
    language: Type.Optional(Type.String()),
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
