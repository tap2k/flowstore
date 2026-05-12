import { Type, type Static } from "@sinclair/typebox";

const strict = { additionalProperties: false } as const;

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

const ExitType = Type.Union([
  Type.Literal("happy"),
  Type.Literal("sad"),
  Type.Literal("off"),
  Type.Literal("exit"),
  Type.Literal("return_to_caller"),
]);

const CapabilityKind = Type.Union([
  Type.Literal("retrieval"),
  Type.Literal("function"),
]);

const VariableDeclSchema = Type.Object(
  {
    type: Type.Optional(VariableType),
    description: Type.Optional(Type.String()),
    values: Type.Optional(Type.Array(Type.String())),
  },
  strict
);

const GuardrailSchema = Type.Object(
  {
    id: Type.String(),
    statement: Type.String(),
  },
  strict
);

const BusinessGoalSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    expression: Type.String(),
    method: Method,
  },
  strict
);

const FaqEntrySchema = Type.Object(
  {
    question: Type.String(),
    answer: Type.String(),
    scripts: Type.Optional(Type.Record(Type.String(), Type.String())),
  },
  strict
);

const GlossaryEntrySchema = Type.Object(
  {
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

const CapabilitySchema = Type.Object(
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

const Mode = Type.Union([Type.Literal("voice"), Type.Literal("text")]);

const AgentMetaSchema = Type.Object(
  {
    name: Type.String(),
    purpose: Type.String(),
    client: Type.Optional(Type.String()),
    languages: Type.Optional(Type.Array(Type.String())),
    modes: Type.Array(Mode, { minItems: 1 }),
  },
  strict
);

const ConditionSchema = Type.Object(
  {
    expression: Type.String(),
    method: Method,
  },
  strict
);

const AssignValueSchema = Type.Object(
  {
    method: Method,
    value: Type.Unknown(),
  },
  strict
);

const ExitPathActionSchema = Type.Object(
  {
    capability_id: Type.String(),
  },
  strict
);

const ExitPathSchema = Type.Object(
  {
    id: Type.String(),
    type: ExitType,
    notes: Type.Optional(Type.String()),
    condition: Type.Optional(ConditionSchema),
    next_flow_id: Type.Union([Type.String(), Type.Null()]),
    assigns: Type.Optional(Type.Record(Type.String(), AssignValueSchema)),
    actions: Type.Optional(Type.Array(ExitPathActionSchema)),
  },
  strict
);

const RoutingSchema = Type.Object(
  {
    entry_condition: Type.Optional(ConditionSchema),
    exit_paths: Type.Array(ExitPathSchema),
  },
  strict
);

const ScriptLineSchema = Type.Object(
  {
    id: Type.String(),
    text: Type.String(),
    variations: Type.Optional(Type.Array(Type.String())),
  },
  strict
);

const FlowKnowledgeSchema = Type.Object(
  {
    faq: Type.Optional(Type.Array(FaqEntrySchema)),
  },
  strict
);

// v1 step schemas — admitted as optional on Flow so v1 specs validate.
const CaptureSchema = Type.Object(
  {
    id: Type.String(),
    variable: Type.String(),
    method: Method,
    pattern: Type.Optional(Type.String()),
    value: Type.Optional(Type.Unknown()),
  },
  strict
);

const UtteranceVariationSchema = Type.Object(
  {
    id: Type.String(),
    text: Type.String(),
  },
  strict
);

const UtteranceSchema = Type.Object(
  {
    id: Type.String(),
    language: Type.String(),
    variations: Type.Array(UtteranceVariationSchema),
  },
  strict
);

const TurnStepSchema = Type.Object(
  {
    id: Type.String(),
    type: Type.Literal("turn"),
    role: Type.Union([Type.Literal("agent"), Type.Literal("user")]),
    label: Type.Optional(Type.String()),
    content: Type.Optional(Type.String()),
    variables_used: Type.Optional(Type.Array(Type.String())),
    condition: Type.Optional(ConditionSchema),
    captures: Type.Optional(Type.Array(CaptureSchema)),
    utterances: Type.Optional(Type.Array(UtteranceSchema)),
  },
  strict
);

const ToolStepSchema = Type.Object(
  {
    id: Type.String(),
    type: Type.Literal("tool"),
    capability_id: Type.String(),
  },
  strict
);

const CallStepSchema = Type.Object(
  {
    id: Type.String(),
    type: Type.Literal("call"),
    description: Type.Optional(Type.String()),
    target_flow_id: Type.String(),
    target_flow_version: Type.Optional(Type.String()),
    input_mapping: Type.Optional(Type.Record(Type.String(), Type.String())),
    output_mapping: Type.Optional(Type.Record(Type.String(), Type.String())),
  },
  strict
);

const StepSchema = Type.Union([TurnStepSchema, ToolStepSchema, CallStepSchema]);

const PipecatHintsSchema = Type.Object(
  {
    context_strategy: Type.Optional(
      Type.Union([Type.Literal("APPEND"), Type.Literal("RESET")])
    ),
    respond_immediately: Type.Optional(Type.Boolean()),
    pre_actions: Type.Optional(Type.Array(Type.Unknown())),
    post_actions: Type.Optional(Type.Array(Type.Unknown())),
  },
  strict
);

export const FlowSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    id: Type.String(),
    version: Type.Optional(Type.String()),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    type: FlowType,
    scope: Type.Optional(Type.Array(Type.String())),
    instructions: Type.Optional(Type.String()),
    scripts: Type.Optional(Type.Record(Type.String(), Type.Array(ScriptLineSchema))),
    steps: Type.Optional(Type.Array(StepSchema)),
    guardrails: Type.Optional(Type.Array(GuardrailSchema)),
    max_turns: Type.Optional(Type.Number()),
    notes: Type.Optional(Type.String()),
    example: Type.Optional(Type.String()),
    knowledge: Type.Optional(FlowKnowledgeSchema),
    variables: Type.Optional(Type.Record(Type.String(), VariableDeclSchema)),
    routing: RoutingSchema,
    pipecat: Type.Optional(PipecatHintsSchema),
  },
  strict
);

export const AgentSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    id: Type.String(),
    version: Type.Optional(Type.String()),
    meta: AgentMetaSchema,
    system_prompt: Type.Optional(Type.String()),
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

export type Method = Static<typeof Method>;
export type VariableType = Static<typeof VariableType>;
export type FlowType = Static<typeof FlowType>;
export type ExitType = Static<typeof ExitType>;
export type CapabilityKind = Static<typeof CapabilityKind>;
export type Mode = Static<typeof Mode>;
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
export type Routing = Static<typeof RoutingSchema>;
export type ScriptLine = Static<typeof ScriptLineSchema>;
export type FlowKnowledge = Static<typeof FlowKnowledgeSchema>;
export type Capture = Static<typeof CaptureSchema>;
export type UtteranceVariation = Static<typeof UtteranceVariationSchema>;
export type Utterance = Static<typeof UtteranceSchema>;
export type TurnStep = Static<typeof TurnStepSchema>;
export type ToolStep = Static<typeof ToolStepSchema>;
export type CallStep = Static<typeof CallStepSchema>;
export type Step = Static<typeof StepSchema>;
export type PipecatHints = Static<typeof PipecatHintsSchema>;
export type Flow = Static<typeof FlowSchema>;
export type Agent = Static<typeof AgentSchema>;
export type Spec = Static<typeof SpecSchema>;
