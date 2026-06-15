import { Type, type Static } from "@sinclair/typebox";

const strict = { additionalProperties: false } as const;

// A translatable string. Either a plain string (monolingual; the value is in
// the agent's default language), or a Record keyed by language code (multi-
// lingual). Codegen/runtime resolves to a single language via `resolveLocalized`.
const LocalizedString = Type.Union([
  Type.String(),
  Type.Record(Type.String(), Type.String()),
]);

const Method = Type.Union([
  Type.Literal("llm"),
  Type.Literal("calculation"),
  Type.Literal("direct"),
]);

const VariableType = Type.Union([
  Type.Literal("string"),
  Type.Literal("number"),
  Type.Literal("boolean"),
  Type.Literal("enum"),
]);

const FlowType = Type.Union([
  Type.Literal("happy"),
  Type.Literal("sad"),
  Type.Literal("off"),
  Type.Literal("utility"),
  Type.Literal("interrupt"),
]);

const CapabilityKind = Type.Union([
  Type.Literal("retrieval"),
  Type.Literal("function"),
]);

export const VariableDeclSchema = Type.Object(
  {
    type: Type.Optional(VariableType),
    description: Type.Optional(Type.String()),
    values: Type.Optional(Type.Array(Type.String())),
    // Boolean expression over the variable bag. When set, the value is
    // withheld from the compiled prompt's volatile suffix until the
    // expression evaluates true. Deterministic-calculation grammar only —
    // no LLM-evaluated visibility (would defeat the prevention guarantee).
    visible_when: Type.Optional(Type.String()),
    // The deployment MAY hand this value to the session at start (dialer
    // payload, screen-pop record, caller ID) — a permission, not a guarantee;
    // an inbound session simply arrives without it. This is the only gate
    // through which test-fixture vars (persona/case character sheets) reach
    // the agent's initial state: unmarked vars never ship, so the agent must
    // earn them through conversation or capability returns. Meaningful on
    // agent-level declarations only (flow vars arise mid-conversation by
    // construction — graphRules warns). Distinct from visible_when: provided
    // = known at start; visible_when = known but withheld until the gate.
    provided: Type.Optional(Type.Boolean()),
  },
  strict
);

export const GuardrailSchema = Type.Object(
  {
    id: Type.String(),
    statement: Type.String(),
  },
  strict
);

export const BusinessGoalSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    expression: Type.String(),
    method: Method,
  },
  strict
);

export const FaqEntrySchema = Type.Object(
  {
    id: Type.String(),
    question: Type.String(),
    answer: LocalizedString,
  },
  strict
);

const GlossaryEntrySchema = Type.Object(
  {
    id: Type.String(),
    term: Type.String(),
    definition: Type.String(),
  },
  strict
);

const TableFieldSchema = Type.Object(
  {
    field: Type.String(),
    description: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
  },
  strict
);

const TableEntrySchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    notes: Type.Optional(Type.String()),
    structure: Type.Array(TableFieldSchema),
    rows: Type.Array(Type.Record(Type.String(), Type.Unknown())),
    scaling_rule: Type.Optional(Type.String()),
  },
  strict
);

const KnowledgeSchema = Type.Object(
  {
    faq: Type.Optional(Type.Array(FaqEntrySchema)),
    glossary: Type.Optional(Type.Array(GlossaryEntrySchema)),
    tables: Type.Optional(Type.Array(TableEntrySchema)),
  },
  strict
);

export const CapabilitySchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    description: Type.String(),
    kind: CapabilityKind,
    inputs: Type.Optional(Type.Array(Type.String())),
    outputs: Type.Optional(Type.Array(Type.String())),
    // When true, the runner dispatches this capability without blocking the
    // conversation — it continues and the declared outputs bind to scope when
    // they land. Only set when the result isn't needed immediately (a
    // downstream entry_condition / next turn that reads the outputs may see
    // them undefined until they land). Non-blocking is portable conversation
    // behavior (it changes observable pacing), not execution: it travels with
    // the spec, like `chatbot_initiates`, and names the behavior, not the
    // runtime's concurrency mechanism. Applies to dispatch on exit-path
    // actions; `retrieve_on_turn` is always pre-LLM/synchronous and ignores
    // this. Absent/false = synchronous.
    non_blocking: Type.Optional(Type.Boolean()),
    // When true, invoking this capability ends the conversation (the agent's
    // "hang up" — a clean end, or a transfer/escalation that hands the call
    // off). Like `non_blocking`, this is portable conversation behavior that
    // names the effect, not the mechanism: the runtime raises a terminal
    // SessionEnded when the capability is invoked, and prompt-mode harnesses
    // end the loop on the captured invocation. Complements a flow exit's
    // `goto: "END"` (the state-machine terminal) — either can end a call.
    // Absent/false = non-terminal.
    ends_conversation: Type.Optional(Type.Boolean()),
    // Optional holding line spoken when a non-blocking dispatch starts ("Let me
    // pull that up…") so there's no dead air while the capability runs.
    pending_message: Type.Optional(LocalizedString),
  },
  strict
);

const AgentMetaSchema = Type.Object(
  {
    // identity/purpose/tone compose the synthesized role line at the top of the
    // system prompt: "You are {identity}. {purpose} Tone: {tone}". Persona, not
    // file metadata — the repo/display label lives on the agent envelope as
    // `name`. Who the agent acts for has no dedicated field: a bare principal
    // ("Tala") isn't self-describing, so it's woven into identity ("Lucía from
    // Tala") and purpose, and enforced (official-channel claims) in guardrails.

    // The name the agent inhabits ("You are {identity}."). Accepts {var}
    // placeholders, so identity can be a per-call input rather than a literal:
    // "{assistant_name}" renders "You are Lucía." when that variable is set.
    identity: Type.String(),
    purpose: Type.String(),
    // How the agent sounds (register/voice), not what it does — behavioral rules
    // belong in guardrails. Appended as "Tone: {tone}".
    tone: Type.Optional(Type.String()),
    // The channel the agent runs on — a design-time fact that shapes the prompt,
    // not a per-run knob (runtime audio settings like TTS voice/VAD stay out of
    // the spec). "voice" ⇒ spoken/telephony, "text" ⇒ chat, "multimodal" ⇒ both.
    modality: Type.Union([
      Type.Literal("voice"),
      Type.Literal("text"),
      Type.Literal("multimodal"),
    ]),
    languages: Type.Optional(Type.Array(Type.String())),
  },
  strict
);

const ConditionSchema = Type.Object(
  {
    expression: Type.String(),
    method: Method,
    pattern: Type.Optional(Type.String()),
  },
  strict
);

const AssignValueSchema = Type.Object(
  {
    method: Method,
    value: Type.Unknown(),
    pattern: Type.Optional(Type.String()),
  },
  strict
);

const ExitPathActionSchema = Type.Object(
  {
    capability_id: Type.String(),
  },
  strict
);

// `goto` is either a flow id (string) or one of the reserved keywords
// "END" / "RETURN". Validated structurally as a string; runtime/validator
// enforces that flow-id references resolve and that the keywords are not
// shadowed by an actual flow id.
const ExitPathSchema = Type.Object(
  {
    id: Type.String(),
    goto: Type.String({ minLength: 1 }),
    condition: Type.Optional(ConditionSchema),
    // Turn-budget escape: fire this exit unconditionally once the flow's
    // active frame has taken `max_turns` agent turns without another exit
    // matching. Deterministic loop protection (matches Voiceflow / Botpress /
    // Twilio Studio per-widget retry caps). Mutually exclusive with
    // `condition` — a budget exit is turn-gated, not condition-gated; the
    // graph validator rejects an exit carrying both.
    max_turns: Type.Optional(Type.Integer({ minimum: 1 })),
    notes: Type.Optional(Type.String()),
    assigns: Type.Optional(Type.Record(Type.String(), AssignValueSchema)),
    actions: Type.Optional(Type.Array(ExitPathActionSchema)),
  },
  strict
);

// Script lines now carry their text per language inline; variations are also
// per language (each language can have its own set of alternative phrasings).
const ScriptLineSchema = Type.Object(
  {
    id: Type.String(),
    text: LocalizedString,
    variations: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
  },
  strict
);

const FlowKnowledgeSchema = Type.Object(
  {
    faq: Type.Optional(Type.Array(FaqEntrySchema)),
  },
  strict
);

export const FlowSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    id: Type.String(),
    version: Type.Optional(Type.String()),
    name: Type.String(),
    type: FlowType,
    instructions: Type.Optional(Type.String()),
    entry_condition: Type.Optional(ConditionSchema),
    exit_paths: Type.Array(ExitPathSchema),
    scripts: Type.Optional(Type.Array(ScriptLineSchema)),
    guardrails: Type.Optional(Type.Array(GuardrailSchema)),
    notes: Type.Optional(Type.String()),
    example: Type.Optional(Type.String()),
    knowledge: Type.Optional(FlowKnowledgeSchema),
    variables: Type.Optional(Type.Record(Type.String(), VariableDeclSchema)),
    // Capability ids fired pre-LLM each turn this flow is active. Outputs
    // bind to the variable bag and the first declared output's text is
    // auto-injected into the system prompt as a "Retrieved context" block.
    // Runner enforces: each id must reference a kind:"retrieval" capability.
    retrieve_on_turn: Type.Optional(Type.Array(Type.String())),
    // Allow-list of agent.capabilities ids exposed as model-callable tools
    // while this flow is active. Omitted/unset = every agent capability is
    // available (current behavior); present = only the listed ids are. Any
    // capability kind may be listed (a kind:"retrieval" cap can be both
    // model-callable here and auto-fired via retrieve_on_turn). This is the
    // per-stage tool scoping a handoff runtime reads on each transition — it
    // does not affect the compiled monolithic prompt. Validator rejects ids
    // that don't resolve to an agent capability.
    tools: Type.Optional(Type.Array(Type.String())),
  },
  strict
);

export const AgentSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    id: Type.String(),
    // Repo/display label — document metadata, parallel to `id` (tab title, app
    // header, README scaffold, save-to-repo default). Never enters the compiled
    // system prompt; the agent's persona name is `meta.identity`.
    name: Type.String(),
    version: Type.Optional(Type.String()),
    meta: AgentMetaSchema,
    chatbot_initiates: Type.Optional(Type.Boolean()),
    // Optional author-owned wrapper around the compiled system prompt.
    // The placeholder `{generated}` expands to all spec-derived sections
    // (role, guardrails, flows, knowledge…). Omitting the placeholder is a
    // deliberate full override; codegen surfaces a warning but allows it.
    // `{variable}` substitution applies just as in flow instructions.
    // Single-language by design: this is LLM-facing framing the model reads,
    // not a verbatim utterance, so it stays a plain string (the model handles
    // multilingual reasoning natively). Only user-facing utterances — script
    // text, FAQ answers, capability pending_message — are LocalizedString.
    system_prompt: Type.Optional(Type.String()),
    variables: Type.Optional(Type.Record(Type.String(), VariableDeclSchema)),
    guardrails: Type.Optional(Type.Array(GuardrailSchema)),
    business_goals: Type.Optional(Type.Array(BusinessGoalSchema)),
    capabilities: Type.Optional(Type.Array(CapabilitySchema)),
    knowledge: Type.Optional(KnowledgeSchema),
    entry_flow_id: Type.String(),
    // Author-facing annotation. Not included in the compiled system prompt.
    notes: Type.Optional(Type.String()),
  },
  strict
);

export const SpecSchema = Type.Object(
  {
    agent: AgentSchema,
    flows: Type.Array(FlowSchema),
  },
  strict
);

export const GOTO_END = "END" as const;
export const GOTO_RETURN = "RETURN" as const;
export type GotoKeyword = typeof GOTO_END | typeof GOTO_RETURN;

export function isEndGoto(goto: string): boolean {
  return goto === GOTO_END;
}
export function isReturnGoto(goto: string): boolean {
  return goto === GOTO_RETURN;
}
export function isFlowGoto(goto: string): boolean {
  return goto !== GOTO_END && goto !== GOTO_RETURN;
}

// === LocalizedString helpers =================================================

export type LocalizedString = string | Record<string, string>;

// First entry in agent.meta.languages is the default. Fall back to "EN" if
// languages is missing (legacy / pre-multilingual specs).
export function defaultLanguage(languages: string[] | undefined): string {
  return languages?.[0] ?? "EN";
}

// Resolve a LocalizedString to a single string for the active language.
// Falls back: requested lang → default lang → any value present → "".
export function resolveLocalized(
  value: LocalizedString | undefined,
  lang: string,
  defaultLang: string,
): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (lang in value) return value[lang];
  if (defaultLang in value) return value[defaultLang];
  const anyKey = Object.keys(value)[0];
  return anyKey ? value[anyKey] : "";
}

// Read the value stored for a specific language (no fallback). Useful when
// the editor needs to show "this language is missing" vs "this language has
// content."
export function getLanguage(
  value: LocalizedString | undefined,
  lang: string,
  defaultLang: string,
): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    return lang === defaultLang ? value : undefined;
  }
  return value[lang];
}

// Write a translation for a specific language. If `value` is currently a
// plain string and `lang` differs from the default, morph it into a Record
// with the existing string under defaultLang and the new text under lang.
export function setLanguage(
  value: LocalizedString | undefined,
  lang: string,
  text: string,
  defaultLang: string,
): LocalizedString | undefined {
  // Empty incoming text means "clear this language" — fall through to delete.
  if (text === "") {
    if (value == null || typeof value === "string") return value;
    const { [lang]: _drop, ...rest } = value;
    void _drop;
    const remaining = Object.keys(rest);
    if (remaining.length === 0) return undefined;
    if (remaining.length === 1 && remaining[0] === defaultLang) return rest[defaultLang];
    return rest;
  }

  if (value == null) {
    return lang === defaultLang ? text : { [lang]: text };
  }
  if (typeof value === "string") {
    if (lang === defaultLang) return text;
    return { [defaultLang]: value, [lang]: text };
  }
  return { ...value, [lang]: text };
}

// Build a LocalizedString from a (lang → text) map, collapsing to a plain
// string when only the default language is present. Returns undefined when
// the map is empty so callers can decide whether to drop the field or
// substitute "".
export function buildLocalized(
  byLang: Record<string, string>,
  defaultLang: string,
): LocalizedString | undefined {
  const keys = Object.keys(byLang);
  if (keys.length === 0) return undefined;
  if (keys.length === 1 && keys[0] === defaultLang) return byLang[defaultLang];
  return byLang;
}

// === Scalar coercion ========================================================

// Coerce an arbitrary value (typically LLM-produced JSON) to the type declared
// by a variable. Returns undefined when the value can't be coerced — callers
// should drop the key rather than store a garbage value.
//
// Distinct from the form-input coercion in `runtime/contextVars` which keeps
// the raw string on number-parse failure so the user can keep typing.
export function coerceScalarValue(
  decl: VariableDecl | undefined,
  value: unknown,
): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  const type = decl?.type ?? "string";
  if (type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  }
  return typeof value === "string" ? value : String(value);
}

// Languages this LocalizedString carries content for. A plain string counts
// as carrying content for the default language.
export function languagesPresent(
  value: LocalizedString | undefined,
  defaultLang: string,
): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [defaultLang];
  return Object.keys(value);
}

export type Method = Static<typeof Method>;
export type VariableType = Static<typeof VariableType>;
export type FlowType = Static<typeof FlowType>;
export type CapabilityKind = Static<typeof CapabilityKind>;
export type VariableDecl = Static<typeof VariableDeclSchema>;
export type Guardrail = Static<typeof GuardrailSchema>;
export type BusinessGoal = Static<typeof BusinessGoalSchema>;
export type FaqEntry = Static<typeof FaqEntrySchema>;
export type GlossaryEntry = Static<typeof GlossaryEntrySchema>;
export type TableField = Static<typeof TableFieldSchema>;
export type TableEntry = Static<typeof TableEntrySchema>;
export type Knowledge = Static<typeof KnowledgeSchema>;
export type Capability = Static<typeof CapabilitySchema>;
export type AgentMeta = Static<typeof AgentMetaSchema>;
export type Modality = AgentMeta["modality"];

// A short human label for the channel. Used only to ground the persona/user-sim
// (and generation context) in how a real person converses on this channel. It is
// deliberately NOT injected into the agent's own compiled prompt: the agent
// author has full control over the agent's output (and the runtime may strip
// markup such as route tags before TTS).
export function channelLabel(modality: Modality): string {
  switch (modality) {
    case "voice":
      return "a spoken phone call";
    case "multimodal":
      return "a conversation that may be spoken aloud or typed";
    case "text":
      return "a text chat";
  }
}
export type Condition = Static<typeof ConditionSchema>;
export type AssignValue = Static<typeof AssignValueSchema>;
export type ExitPathAction = Static<typeof ExitPathActionSchema>;
export type ExitPath = Static<typeof ExitPathSchema>;
export type ScriptLine = Static<typeof ScriptLineSchema>;
export type FlowKnowledge = Static<typeof FlowKnowledgeSchema>;
export type Flow = Static<typeof FlowSchema>;
export type Agent = Static<typeof AgentSchema>;
export type Spec = Static<typeof SpecSchema>;
