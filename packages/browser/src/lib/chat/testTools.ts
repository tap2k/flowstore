// Testing-artifact tools for the chat co-author.
//
// The spec tools (tools.ts) mutate the spec store; these mutate the *testing*
// store (useTestsStore) — the personas, test cases, rubrics, and golds that
// live under tests/ and ship next to the spec. The model authors the JSON
// body directly (same as create_flow/update_flow); the tool mints a unique id,
// stamps $schema, validates against the file schema, and persists. A failed
// validation comes back as a tool error so the agentic loop can fix it,
// mirroring the spec-validation feedback in ChatPanel.
//
// Guardrails are NOT here — they're agent/flow fields edited via
// update_agent / update_flow in tools.ts.

import { useTestsStore } from "@/lib/store/tests";
import { validateFile, formatErrors } from "@flowstore/core/validation/ajv";
import { PersonaSchema, type Persona } from "@flowstore/core/schema/files/persona";
import { TestCaseSchema, type TestCase } from "@flowstore/core/schema/files/testCase";
import { RubricSchema, type Rubric } from "@flowstore/core/schema/files/rubric";
import { GoldSchema, type Gold } from "@flowstore/core/schema/files/gold";
import type { JSONSchema } from "@flowstore/core/llm/types";
import type { Tool, ToolResult } from "./tools";

function tests() {
  return useTestsStore.getState();
}

// Validate an assembled artifact against its file schema. Returns the typed
// object on success, or a ToolResult error (compact, first ~12 messages) the
// caller returns straight to the model.
function check<T>(schema: object, obj: unknown): { ok: true; value: T } | ToolResult {
  const v = validateFile(schema as Parameters<typeof validateFile>[0], obj);
  if (!v.valid) {
    return { ok: false, error: `validation failed: ${formatErrors(v.errors).slice(0, 12).join("; ")}` };
  }
  return { ok: true, value: obj as T };
}

function isErr(x: { ok: true } | ToolResult): x is ToolResult {
  return x.ok === false;
}

// Drop keys whose value is undefined so we never write `field: undefined` into
// an additionalProperties:false object (ajv treats a present undefined key as a
// validation error under strict typing). The model omits fields it doesn't set,
// but a spread of optionals can still introduce them.
function clean<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, val] of Object.entries(obj)) {
    if (val !== undefined) out[k] = val;
  }
  return out as T;
}


//
// Open dicts (vars, mocks, returns) are typed as bare objects with the shape
// described in prose: Gemini's schema dialect (OpenAPI 3.0 subset) drops
// additionalProperties, so a Record's value type can't be expressed there.

const VARS_DESC =
  "Free-form { variable_name: value } dict, coerced against the agent's variables at run time.";

const MOCKS_DESC =
  "Map from capability_id to a mock behavior. Each value is either " +
  "{ kind: 'static', returns: { output_name: value, ... } } (the call resolves to that dict) " +
  "or { kind: 'error', error: 'message' } (the call raises that error).";

const VarsSchema: JSONSchema = { type: "object", description: VARS_DESC };
const MocksSchema: JSONSchema = { type: "object", description: MOCKS_DESC };

const AssertionSchema: JSONSchema = {
  type: "object",
  description: "Per-turn substring check. `turn` is 1-indexed over agent-only turns.",
  properties: {
    turn: { type: "integer", minimum: 1 },
    must_contain: { type: "array", items: { type: "string" } },
    must_not_contain: { type: "array", items: { type: "string" } },
  },
  required: ["turn"],
};

const StateAssertionSchema: JSONSchema = {
  type: "object",
  description:
    "End-state check over a final variable. Provide exactly one of equals / matches / is_set.",
  properties: {
    variable: { type: "string" },
    equals: { type: "string", description: "Strict-equality target (as a string; numbers/booleans compared loosely)." },
    matches: { type: "string", description: "Regex matched against the stringified value." },
    is_set: { type: "boolean", description: "true: variable bound to a non-null value; false: absent or null." },
  },
  required: ["variable"],
};

const TranscriptAssertionSchema: JSONSchema = {
  type: "object",
  description:
    "Whole-transcript check (agent turns only). kind: 'substring' (case-insensitive), 'regex', " +
    "'count' (occurrences within [min,max]), or 'must_terminate_within' (at most max_turns turns).",
  properties: {
    kind: { type: "string", enum: ["substring", "regex", "count", "must_terminate_within"] },
    pattern: { type: "string" },
    must_appear: { type: "boolean", description: "For substring/regex: must the pattern appear? Defaults true." },
    min_occurrences: { type: "integer", minimum: 0 },
    max_occurrences: { type: "integer", minimum: 0 },
    max_turns: { type: "integer", minimum: 1 },
  },
  required: ["kind"],
};

const CapabilityAssertionSchema: JSONSchema = {
  type: "object",
  description: "Did the agent invoke a capability? `capability` is the capability id.",
  properties: {
    capability: { type: "string" },
    invoked: { type: "boolean", description: "true: fired at least once; false: never fired. Defaults true." },
  },
  required: ["capability"],
};

const GoldTurnSchema: JSONSchema = {
  type: "object",
  properties: {
    role: { type: "string", enum: ["agent", "user"] },
    text: { type: "string" },
  },
  required: ["role", "text"],
};

const ScaleSchema: JSONSchema = {
  type: "object",
  description: "Numeric range the judge returns, e.g. { min: 1, max: 5 }.",
  properties: { min: { type: "number" }, max: { type: "number" } },
  required: ["min", "max"],
};

const DEFAULT_RUBRIC_TEMPLATE =
  "You are grading a conversation transcript.\n\n" +
  "Criterion: {criteria}\n\n" +
  "Transcript:\n{transcript}\n\n" +
  "Return a single integer score on the rubric's scale (higher is better) plus a one-sentence justification.";


const createPersonaTool: Tool = {
  definition: {
    name: "create_persona",
    description:
      "Create a reusable persona — an ACTOR that plays the user side of a simulated conversation. " +
      "`system_prompt` is required and drives LLM-as-user. Put character-intrinsic facts in vars/mocks " +
      "(true of this character in every test); situational fixtures belong on the test case. " +
      "Returns the new persona id.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Human-readable label, e.g. 'Frustrated late payer'." },
        system_prompt: { type: "string", description: "The user-actor prompt: who they are, their goal, how they talk." },
        notes: { type: "string", description: "What this persona is for / what it stresses." },
        vars: VarsSchema,
        mocks: MocksSchema,
        model: { type: "string", description: "Optional per-persona model override." },
      },
      required: ["system_prompt"],
    },
  },
  impl: (args) => {
    const a = args as Partial<Persona> & { system_prompt: string };
    const id = tests().uniquePersonaId(a.name || "persona");
    const persona = clean<Persona>({
      $schema: "flowstore://test/persona/v0",
      id,
      system_prompt: a.system_prompt,
      name: a.name,
      notes: a.notes,
      model: a.model,
      vars: a.vars,
      mocks: a.mocks,
    });
    const v = check<Persona>(PersonaSchema, persona);
    if (isErr(v)) return v;
    tests().savePersona(v.value);
    return { ok: true, data: { id } };
  },
};

const updatePersonaTool: Tool = {
  definition: {
    name: "update_persona",
    description:
      "Patch fields on an existing persona by id. Only included fields change; vars and mocks " +
      "are merged (existing keys are preserved unless overwritten), so you only need to include the keys you want to add or change.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        patch: {
          type: "object",
          properties: {
            name: { type: "string" },
            system_prompt: { type: "string" },
            notes: { type: "string" },
            vars: VarsSchema,
            mocks: MocksSchema,
            model: { type: "string" },
          },
        },
      },
      required: ["id", "patch"],
    },
  },
  impl: (args) => {
    const { id, patch } = args as { id: string; patch: Partial<Persona> };
    const existing = tests().personas.find((p) => p.id === id);
    if (!existing) return { ok: false, error: `persona not found: ${id}` };
    const merged = clean<Persona>({
      ...existing,
      ...patch,
      vars: patch.vars ? { ...existing.vars, ...patch.vars } : existing.vars,
      mocks: patch.mocks ? { ...existing.mocks, ...patch.mocks } : existing.mocks,
      $schema: existing.$schema,
      id,
    });
    const v = check<Persona>(PersonaSchema, merged);
    if (isErr(v)) return v;
    tests().savePersona(v.value);
    return { ok: true, record: v.value };
  },
};

const getPersonaTool: Tool = {
  definition: {
    name: "get_persona",
    description:
      "Return the full current record for a persona by id — including its system_prompt, vars, and mocks. " +
      "Call this before update_persona when you need to know the existing state (e.g. to preserve vars you are not changing).",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  impl: (args) => {
    const { id } = args as { id: string };
    const persona = tests().personas.find((p) => p.id === id);
    if (!persona) return { ok: false, error: `persona not found: ${id}` };
    return { ok: true, record: persona };
  },
};

const deletePersonaTool: Tool = {
  definition: {
    name: "delete_persona",
    description:
      "Delete a persona by id. Cases bound to it lose the binding (and fall back to any inline fixture).",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  impl: (args) => {
    const { id } = args as { id: string };
    if (!tests().personas.some((p) => p.id === id)) return { ok: false, error: `persona not found: ${id}` };
    tests().deletePersona(id);
    return { ok: true };
  },
};


const CASE_ACTOR_DESC =
  "Provide exactly one actor: `user_turns` (verbatim scripted user inputs), `persona_id` " +
  "(a reusable persona that drives the user side), or `system_prompt` (an inline one-off user actor).";

const caseProps: Record<string, JSONSchema> = {
  name: { type: "string" },
  notes: { type: "string" },
  user_turns: { type: "array", items: { type: "string" }, description: "Scripted: verbatim user inputs, in order." },
  persona_id: { type: "string", description: "Reusable persona actor. Mutually exclusive with user_turns/system_prompt." },
  system_prompt: { type: "string", description: "Inline one-off user actor. Mutually exclusive with user_turns/persona_id." },
  vars: VarsSchema,
  mocks: MocksSchema,
  evaluators: { type: "array", items: { type: "string" }, description: "Rubric ids or Python evaluator names to run." },
  assertions: { type: "array", items: AssertionSchema },
  state_assertions: { type: "array", items: StateAssertionSchema },
  transcript_assertions: { type: "array", items: TranscriptAssertionSchema },
  capability_assertions: { type: "array", items: CapabilityAssertionSchema },
  gold_id: { type: "string", description: "Reference gold transcript for gold-comparing rubrics." },
  max_turns: { type: "integer", minimum: 1, description: "Cap on persona-driven runs." },
  language: { type: "string", description: "Language code (e.g. 'EN'); required when the spec declares >1 language." },
  tags: { type: "array", items: { type: "string" }, description: "Free-form labels for suite filtering." },
  model: { type: "string", description: "Optional per-case model override." },
};

const createTestCaseTool: Tool = {
  definition: {
    name: "create_test_case",
    description:
      "Create a test case: how the conversation is driven (the actor) + the situational fixture + the " +
      "evaluators/assertions that judge the run. " +
      CASE_ACTOR_DESC +
      " Returns the new case id.",
    parameters: { type: "object", properties: caseProps },
  },
  impl: (args) => {
    const a = (args ?? {}) as Partial<TestCase>;
    const id = tests().uniqueCaseId(a.name || "case");
    const testCase = clean<TestCase>({
      ...a,
      $schema: "flowstore://test/case/v0",
      id,
    });
    const v = check<TestCase>(TestCaseSchema, testCase);
    if (isErr(v)) return v;
    tests().saveCase(v.value);
    return { ok: true, data: { id } };
  },
};

const updateTestCaseTool: Tool = {
  definition: {
    name: "update_test_case",
    description:
      "Patch fields on an existing test case by id. Only included fields change; vars and mocks " +
      "are merged (existing keys are preserved unless overwritten). Array fields (assertions, evaluators, …) replace the whole field, so include all entries to keep.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" }, patch: { type: "object", properties: caseProps } },
      required: ["id", "patch"],
    },
  },
  impl: (args) => {
    const { id, patch } = args as { id: string; patch: Partial<TestCase> };
    const existing = tests().cases.find((c) => c.id === id);
    if (!existing) return { ok: false, error: `test case not found: ${id}` };
    const merged = clean<TestCase>({
      ...existing,
      ...patch,
      vars: patch.vars ? { ...existing.vars, ...patch.vars } : existing.vars,
      mocks: patch.mocks ? { ...existing.mocks, ...patch.mocks } : existing.mocks,
      $schema: existing.$schema,
      id,
    });
    const v = check<TestCase>(TestCaseSchema, merged);
    if (isErr(v)) return v;
    tests().saveCase(v.value);
    return { ok: true, record: v.value };
  },
};

const getTestCaseTool: Tool = {
  definition: {
    name: "get_test_case",
    description:
      "Return the full current record for a test case by id — including its vars, mocks, assertions, and actor. " +
      "Call this before update_test_case when you need to know the existing state.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  impl: (args) => {
    const { id } = args as { id: string };
    const testCase = tests().cases.find((c) => c.id === id);
    if (!testCase) return { ok: false, error: `test case not found: ${id}` };
    return { ok: true, record: testCase };
  },
};

const deleteTestCaseTool: Tool = {
  definition: {
    name: "delete_test_case",
    description: "Delete a test case by id.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  impl: (args) => {
    const { id } = args as { id: string };
    if (!tests().cases.some((c) => c.id === id)) return { ok: false, error: `test case not found: ${id}` };
    tests().deleteCase(id);
    return { ok: true };
  },
};


const createRubricTool: Tool = {
  definition: {
    name: "create_rubric",
    description:
      "Create an LLM-judge rubric — a criterion a judge model scores the transcript against. " +
      "`prompt_template` may use {transcript}, {criteria}, {gold_standard} placeholders; if omitted, a " +
      "standard template is used. `scale` defaults to { min: 1, max: 5 }. Reference it from a case's " +
      "evaluators[] by its id. Returns the new rubric id.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        criteria: { type: "string", description: "What this rubric scores (e.g. 'empathy and tone')." },
        scale: ScaleSchema,
        prompt_template: { type: "string", description: "Judge prompt with {transcript}/{criteria}/{gold_standard} placeholders." },
        model: { type: "string", description: "Optional per-rubric judge-model pin." },
      },
      required: ["criteria"],
    },
  },
  impl: (args) => {
    const a = args as Partial<Rubric> & { criteria: string };
    const id = tests().uniqueRubricId(a.name || a.criteria || "rubric");
    const rubric = clean<Rubric>({
      $schema: "flowstore://test/rubric/v0",
      id,
      name: a.name,
      criteria: a.criteria,
      scale: a.scale ?? { min: 1, max: 5 },
      prompt_template: a.prompt_template ?? DEFAULT_RUBRIC_TEMPLATE,
      model: a.model,
    });
    const v = check<Rubric>(RubricSchema, rubric);
    if (isErr(v)) return v;
    tests().saveRubric(v.value);
    return { ok: true, data: { id } };
  },
};

const updateRubricTool: Tool = {
  definition: {
    name: "update_rubric",
    description: "Patch fields on an existing rubric by id. Only included fields change.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        patch: {
          type: "object",
          properties: {
            name: { type: "string" },
            criteria: { type: "string" },
            scale: ScaleSchema,
            prompt_template: { type: "string" },
            model: { type: "string" },
          },
        },
      },
      required: ["id", "patch"],
    },
  },
  impl: (args) => {
    const { id, patch } = args as { id: string; patch: Partial<Rubric> };
    const existing = tests().rubrics.find((r) => r.id === id);
    if (!existing) return { ok: false, error: `rubric not found: ${id}` };
    const merged = clean<Rubric>({ ...existing, ...patch, $schema: existing.$schema, id });
    const v = check<Rubric>(RubricSchema, merged);
    if (isErr(v)) return v;
    tests().saveRubric(v.value);
    return { ok: true };
  },
};

const deleteRubricTool: Tool = {
  definition: {
    name: "delete_rubric",
    description: "Delete a rubric by id. Strips its id from every case's evaluators[].",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  impl: (args) => {
    const { id } = args as { id: string };
    if (!tests().rubrics.some((r) => r.id === id)) return { ok: false, error: `rubric not found: ${id}` };
    tests().deleteRubric(id);
    return { ok: true };
  },
};


const createGoldTool: Tool = {
  definition: {
    name: "create_gold",
    description:
      "Create a gold — a verbatim reference transcript showing how a conversation should go. " +
      "`turns` is an ordered list of { role: 'agent'|'user', text }. Consumed by gold-comparing rubrics " +
      "(a case references it via gold_id). Returns the new gold id.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        notes: { type: "string" },
        turns: { type: "array", items: GoldTurnSchema },
        source_pointer: { type: "string", description: "Where this gold came from (a doc/source reference)." },
      },
      required: ["turns"],
    },
  },
  impl: (args) => {
    const a = args as Partial<Gold> & { turns: Gold["turns"] };
    const id = tests().uniqueGoldId(a.name || "gold");
    const gold = clean<Gold>({
      $schema: "flowstore://test/gold/v0",
      id,
      name: a.name,
      notes: a.notes,
      turns: a.turns,
      source_pointer: a.source_pointer,
    });
    const v = check<Gold>(GoldSchema, gold);
    if (isErr(v)) return v;
    tests().saveGold(v.value);
    return { ok: true, data: { id } };
  },
};

const updateGoldTool: Tool = {
  definition: {
    name: "update_gold",
    description: "Patch fields on an existing gold by id. `turns` replaces the whole transcript.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        patch: {
          type: "object",
          properties: {
            name: { type: "string" },
            notes: { type: "string" },
            turns: { type: "array", items: GoldTurnSchema },
            source_pointer: { type: "string" },
          },
        },
      },
      required: ["id", "patch"],
    },
  },
  impl: (args) => {
    const { id, patch } = args as { id: string; patch: Partial<Gold> };
    const existing = tests().golds.find((g) => g.id === id);
    if (!existing) return { ok: false, error: `gold not found: ${id}` };
    const merged = clean<Gold>({ ...existing, ...patch, $schema: existing.$schema, id });
    const v = check<Gold>(GoldSchema, merged);
    if (isErr(v)) return v;
    tests().saveGold(v.value);
    return { ok: true };
  },
};

const deleteGoldTool: Tool = {
  definition: {
    name: "delete_gold",
    description: "Delete a gold by id. Cases referencing it drop their gold_id.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  impl: (args) => {
    const { id } = args as { id: string };
    if (!tests().golds.some((g) => g.id === id)) return { ok: false, error: `gold not found: ${id}` };
    tests().deleteGold(id);
    return { ok: true };
  },
};

export const testTools: Tool[] = [
  getPersonaTool,
  createPersonaTool,
  updatePersonaTool,
  deletePersonaTool,
  getTestCaseTool,
  createTestCaseTool,
  updateTestCaseTool,
  deleteTestCaseTool,
  createRubricTool,
  updateRubricTool,
  deleteRubricTool,
  createGoldTool,
  updateGoldTool,
  deleteGoldTool,
];
