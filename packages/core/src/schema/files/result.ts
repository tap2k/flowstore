import { Type, type Static } from "@sinclair/typebox";

// What a testing script writes after one run of a test case. The editor's
// result viewer reads exactly this shape — the contract is load-bearing.
// final_variables is optional because not every script tracks a variable
// scope; state_check-style evaluation needs it, simpler scripts don't.
// Modality-aware usage, shared by per-turn and whole-run rollup. Unit-typed
// so S2S columns (audio tokens) slot in beside text without artifact
// migration; `cost` is dollars as reported by the provider (OpenRouter),
// absent elsewhere.
const UsageSchema = Type.Object(
  {
    text_in: Type.Optional(Type.Number()),
    text_out: Type.Optional(Type.Number()),
    audio_in: Type.Optional(Type.Number()),
    audio_out: Type.Optional(Type.Number()),
    cached: Type.Optional(Type.Number()),
    cost: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);

const TranscriptTurn = Type.Object(
  {
    role: Type.Union([
      Type.Literal("agent"),
      Type.Literal("user"),
      Type.Literal("system"),
    ]),
    content: Type.String(),
    // Wall-clock latency of the dispatch that produced this turn (agent turns).
    latency_ms: Type.Optional(Type.Number()),
    usage: Type.Optional(UsageSchema),
    // Flow-node attribution: which spec node this turn belongs to. In prompt
    // mode there is no runtime flow state, so attribution is inferred
    // post-hoc (mode: "inferred", with confidence); runner mode observes it.
    node: Type.Optional(
      Type.Object(
        {
          id: Type.String(),
          mode: Type.Union([Type.Literal("inferred"), Type.Literal("observed")]),
          confidence: Type.Optional(Type.Number()),
        },
        { additionalProperties: true },
      ),
    ),
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
    $schema: Type.Literal("flowstore://run/result/v0"),
    test_case_id: Type.String(),
    timestamp: Type.String(),
    agent_id: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    // Where the system prompt came from for this run. "flowstore-compile" for the
    // default (compiled from the spec), or a free-form string (e.g. a file
    // path, "claude-3.5-handcrafted", "vendor-x-prompt-v2") for comparison
    // runs against hand-authored or third-party prompts. Tool schemas always
    // come from the spec — comparison runs vary only the prose. Embedded on
    // the result (rather than only on the eventual run manifest) so result
    // files remain self-describing when copied or diffed in isolation —
    // same rationale as `model` above.
    prompt_source: Type.Optional(Type.String()),
    // Language of the run (echoes the case's language for the same
    // self-description rationale as `model` — result files stay meaningful
    // when copied or diffed in isolation).
    language: Type.Optional(Type.String()),
    // Whole-run usage rollup (same unit-typed shape as per-turn usage).
    usage: Type.Optional(UsageSchema),
    transcript: Type.Array(TranscriptTurn),
    capability_calls: Type.Optional(Type.Array(CapabilityCall)),
    final_variables: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    evaluator_results: Type.Optional(Type.Array(EvaluatorResult)),
    trials: Type.Optional(Type.Array(Trial)),
    error: Type.Optional(Type.String()),
  },
  // Open at the top level: a result is a MACHINE-written artifact, so forward-
  // compat (a newer runner adding fields an older reader doesn't know) beats
  // authoring-typo catching — strictness follows authorship. Hand-authored
  // files (persona/case/gold) stay strict; do not generalize this to them.
  { additionalProperties: true },
);

export type Result = Static<typeof ResultSchema>;
