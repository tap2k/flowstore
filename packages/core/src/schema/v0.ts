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
    purpose: Type.Optional(Type.String()),
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
  },
  strict
);

const AgentMetaSchema = Type.Object(
  {
    name: Type.String(),
    purpose: Type.String(),
    client: Type.Optional(Type.String()),
    tone: Type.Optional(Type.String()),
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
  },
  strict
);

export const AgentSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    id: Type.String(),
    version: Type.Optional(Type.String()),
    meta: AgentMetaSchema,
    chatbot_initiates: Type.Optional(Type.Boolean()),
    variables: Type.Optional(Type.Record(Type.String(), VariableDeclSchema)),
    guardrails: Type.Optional(Type.Array(GuardrailSchema)),
    business_goals: Type.Optional(Type.Array(BusinessGoalSchema)),
    capabilities: Type.Optional(Type.Array(CapabilitySchema)),
    knowledge: Type.Optional(KnowledgeSchema),
    entry_flow_id: Type.String(),
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
export type Condition = Static<typeof ConditionSchema>;
export type AssignValue = Static<typeof AssignValueSchema>;
export type ExitPathAction = Static<typeof ExitPathActionSchema>;
export type ExitPath = Static<typeof ExitPathSchema>;
export type ScriptLine = Static<typeof ScriptLineSchema>;
export type FlowKnowledge = Static<typeof FlowKnowledgeSchema>;
export type Flow = Static<typeof FlowSchema>;
export type Agent = Static<typeof AgentSchema>;
export type Spec = Static<typeof SpecSchema>;
