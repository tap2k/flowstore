import { Type, type Static } from "@sinclair/typebox";
import { MockBehaviorSchema } from "./mockBehavior";

// A persona is a reusable ACTOR playing the user side of a conversation
// under test: a system prompt driving LLM-as-user, plus a COMPLETE,
// STANDALONE-RUNNABLE fixture — the facts intrinsic to that character
// (caller_name, the policy_id their identity is keyed on, the verify_policy
// return that names them) AND a baseline situation (the vars the agent reads,
// the mocks it calls). A persona-driven simulation has no test case, so the
// persona must be self-sufficient: it is the whole world.
//
// A test case is a SCENARIO OVERLAY: it overrides specific keys to vary the
// persona's baseline (a different amount, a file_claim mock that errors) and
// always wins on merge (see testCase.ts). Keep character facts here and a
// scenario-specific mock next to the assertion it justifies on the case;
// otherwise put a runnable default here.
//
// system_prompt is REQUIRED — a persona is an actor, not a fixture bag. There
// is no fixture-only persona.
export const PersonaSchema = Type.Object(
  {
    $schema: Type.Literal("flowstore://test/persona/v0"),
    id: Type.String(),
    // Required and non-empty — a persona is an actor, and an empty prompt is
    // not one. (Legacy "world-only" personas omitted the key entirely; that
    // absence is migrated away before validation. A present-but-empty prompt is
    // a new-model authoring mistake, rejected here at load rather than silently
    // dropped.) How to AUTHOR a good persona prompt lives in SCHEMA.md
    // § Testing Artifact Schemas → Persona (the author-facing surface); this is
    // just the shape contract.
    system_prompt: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    // The character's full var sheet: facts intrinsic to them AND a baseline
    // situation (the vars the agent reads) so the persona runs standalone.
    // Free-form {variable_name: value} dict, coerced against agent.variables.
    // This is a CHARACTER SHEET, not session-start input: at run time only the
    // keys whose agent-level declaration says `provided: true` (the
    // session-start payload — dialer record, caller ID) ship to the agent;
    // everything else is edit-time ground truth for persona prompt generation,
    // mock consistency, and assertions, and reaches the agent only when the
    // persona says it or a mock returns it (see VariableDeclSchema.provided).
    // A case overrides the situational keys per scenario.
    vars: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    // Per-capability behaviors keyed by capability id (e.g. a verify_policy
    // return keyed on this caller's identity). Mock every capability whose
    // outputs the agent reads, so the persona runs standalone. Caps not listed
    // fall through to the live capability (or {} if none). A case's mocks
    // replace the persona's per capability id.
    mocks: Type.Optional(Type.Record(Type.String(), MockBehaviorSchema)),
    // Open behavioral knobs (flat scalars). Deliberately NOT inlined into the
    // persona prompt — they're machine-read, so leaving the bag open costs
    // nothing. The envelope above stays strict (typos in real fields error);
    // this is the one open extension point. The keys flowstore interprets:
    //   asr      — ASR-shaping level ("clean"|"light"|"heavy") for an
    //              unintelligible caller (the channel garbles their turns).
    //   barge_in — interruption propensity (0–1) for an impatient caller (cuts
    //              the agent off, trimming its prior turn). Voice/prompt mode.
    // Kept OPEN so an end client can add + interpret its own fields without a
    // schema change. Keys flowstore doesn't know are saved but INERT: traits are
    // never inlined into the prompt, so they never reach the LLM — an unknown
    // key is only meaningful to a client's own harness that reads it.
    traits: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
      ),
    ),
    // Suite-filter labels, symmetric with TestCase.tags. Colon-namespace
    // convention ("lang:hi", "flow:<flow_id>"); bare tags for routing buckets
    // ("negotiation", "cooperative"). Unvalidated annotation — not a coverage
    // guarantee. Lets a persona be filtered the same way the cases that bind it
    // are.
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export type Persona = Static<typeof PersonaSchema>;
export type PersonaTraits = NonNullable<Persona["traits"]>;
