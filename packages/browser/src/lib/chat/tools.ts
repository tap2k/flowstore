import { useSpecStore } from "@/lib/store/spec";
import { useAssistantChangesStore } from "@/lib/store/assistantChanges";
import { gitTools } from "./gitTools";
import { testTools } from "./testTools";
import type { Agent, ExitPath, Flow } from "@flowstore/core/schema/v0";
import { GOTO_END, GOTO_RETURN, isEndGoto, isReturnGoto } from "@flowstore/core/schema/v0";
import type { JSONSchema, ToolDefinition } from "@flowstore/core/llm/types";

export type ToolResult =
  | { ok: true; data?: Record<string, unknown> }
  | { ok: false; error: string };

export type ToolImpl = (args: unknown) => ToolResult | Promise<ToolResult>;

export type Tool = {
  definition: ToolDefinition;
  impl: ToolImpl;
};

const FlowTypeSchema: JSONSchema = {
  type: "string",
  enum: ["happy", "sad", "off", "utility", "interrupt"],
};

const GotoSchema: JSONSchema = {
  type: "string",
  description:
    "Destination of the exit path: another flow's id, or the reserved keyword 'END' (terminate) or 'RETURN' (return to caller).",
};

const MethodSchema: JSONSchema = {
  type: "string",
  enum: ["llm", "calculation", "direct"],
};

const ConditionSchema: JSONSchema = {
  type: "object",
  description: "A condition expression and the method used to evaluate it.",
  properties: {
    method: MethodSchema,
    expression: { type: "string" },
  },
  required: ["method", "expression"],
};

const GuardrailItemSchema: JSONSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    statement: { type: "string" },
  },
  required: ["id", "statement"],
};

// Used in description text only, since Gemini's schema dialect (OpenAPI 3.0
// subset) doesn't support additionalProperties and we have to drop the open
// dictionary value-type constraint.
const VARIABLE_DECL_DESC =
  "{ type?: 'string'|'number'|'boolean'|'enum', description?: string, values?: string[] }";

const FaqItemSchema: JSONSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable id, e.g. 'faq_decaf'. Required." },
    question: { type: "string" },
    answer: {
      type: "string",
      description:
        "Default-language answer. Plain string for monolingual specs. Translations are added later via the Translations sheet.",
    },
  },
  required: ["id", "question", "answer"],
};

const FlowPatchSchema: JSONSchema = {
  type: "object",
  description:
    "Fields to overwrite on the flow. Only included fields change. Routing is managed by add_exit_path/update_exit_path/delete_exit_path; scripts are not chat-editable.",
  properties: {
    name: { type: "string" },
    type: FlowTypeSchema,
    instructions: { type: "string" },
    example: { type: "string" },
    notes: { type: "string" },
    guardrails: { type: "array", items: GuardrailItemSchema },
    variables: {
      type: "object",
      description: `Map from variable name to declaration. Each value is ${VARIABLE_DECL_DESC}.`,
    },
    knowledge: {
      type: "object",
      properties: { faq: { type: "array", items: FaqItemSchema } },
    },
    entry_condition: ConditionSchema,
  },
};

const AgentPatchSchema: JSONSchema = {
  type: "object",
  description: "Fields to overwrite on the agent. Only included fields change.",
  properties: {
    name: { type: "string", description: "Repo/display label for the agent. Never shown to the model." },
    meta: {
      type: "object",
      properties: {
        identity: { type: "string", description: "The name the agent inhabits; compiled into the system prompt as \"You are …\"." },
        purpose: { type: "string" },
        modality: { type: "string", enum: ["voice", "text", "multimodal"] },
        languages: { type: "array", items: { type: "string" } },
      },
    },
    chatbot_initiates: { type: "boolean" },
    entry_flow_id: { type: "string" },
    guardrails: { type: "array", items: GuardrailItemSchema },
    variables: {
      type: "object",
      description: `Map from variable name to declaration. Each value is ${VARIABLE_DECL_DESC}.`,
    },
    capabilities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          kind: { type: "string", enum: ["retrieval", "function"] },
          inputs: { type: "array", items: { type: "string" } },
          outputs: { type: "array", items: { type: "string" } },
        },
        required: ["id", "name", "description", "kind"],
      },
    },
    knowledge: {
      type: "object",
      properties: {
        faq: { type: "array", items: FaqItemSchema },
        glossary: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable id, e.g. 'gloss_drip'. Required." },
              term: { type: "string" },
              definition: { type: "string" },
            },
            required: ["id", "term", "definition"],
          },
        },
      },
    },
  },
};

const ExitPathPatchSchema: JSONSchema = {
  type: "object",
  description: "Fields to overwrite on the exit path. Only included fields change.",
  properties: {
    goto: GotoSchema,
    condition: ConditionSchema,
    notes: { type: "string" },
    assigns: {
      type: "object",
      description:
        "Variable assignments triggered when this path is taken. Keys are variable names; each value is { method: 'llm'|'calculation'|'direct', value: any }.",
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: { capability_id: { type: "string" } },
        required: ["capability_id"],
      },
    },
  },
};

function store() {
  return useSpecStore.getState();
}

// Every successful spec mutation below marks what it touched so the canvas
// can attribute the change to the assistant (glow + one camera focus per
// turn — see assistantChanges.ts). User-driven edits never mark.
function marks() {
  return useAssistantChangesStore.getState();
}

function flowExists(flowId: string): boolean {
  return store().spec?.flows.some((f) => f.id === flowId) ?? false;
}

const createFlowTool: Tool = {
  definition: {
    name: "create_flow",
    description:
      "Create a new flow with a generated id. Optionally set initial fields. Returns the new flow_id.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: FlowTypeSchema,
        instructions: { type: "string" },
      },
      required: ["name"],
    },
  },
  impl: (args) => {
    const a = args as {
      name: string;
      type?: Flow["type"];
      instructions?: string;
    };
    const s = store();
    const id = s.addFlow(false, a.name); // seed doubles as the flow's name
    const patch: Partial<Flow> = {};
    if (a.type) patch.type = a.type;
    if (a.instructions !== undefined) patch.instructions = a.instructions;
    if (Object.keys(patch).length) s.updateFlow(id, patch);
    marks().markFlow(id, { created: true });
    return { ok: true, data: { flow_id: id } };
  },
};

const deleteFlowTool: Tool = {
  definition: {
    name: "delete_flow",
    description: "Delete a flow by id. Removes references from other flows' exit paths.",
    parameters: {
      type: "object",
      properties: { flow_id: { type: "string" } },
      required: ["flow_id"],
    },
  },
  impl: (args) => {
    const { flow_id } = args as { flow_id: string };
    if (!flowExists(flow_id)) return { ok: false, error: `flow not found: ${flow_id}` };
    store().removeFlow(flow_id);
    marks().unmarkFlow(flow_id);
    return { ok: true };
  },
};

const updateFlowTool: Tool = {
  definition: {
    name: "update_flow",
    description: "Patch fields on an existing flow.",
    parameters: {
      type: "object",
      properties: {
        flow_id: { type: "string" },
        patch: FlowPatchSchema,
      },
      required: ["flow_id", "patch"],
    },
  },
  impl: (args) => {
    const { flow_id, patch } = args as { flow_id: string; patch: Partial<Flow> };
    if (!flowExists(flow_id)) return { ok: false, error: `flow not found: ${flow_id}` };
    store().updateFlow(flow_id, patch);
    marks().markFlow(flow_id);
    return { ok: true };
  },
};

const addExitPathTool: Tool = {
  definition: {
    name: "add_exit_path",
    description:
      "Create an exit path from a flow. The `goto` field is the destination: another flow's id, 'END' to terminate, or 'RETURN' to return to the calling flow. Returns the new exit_path_id.",
    parameters: {
      type: "object",
      properties: {
        source_flow_id: { type: "string" },
        goto: GotoSchema,
        condition: ConditionSchema,
      },
      required: ["source_flow_id", "goto"],
    },
  },
  impl: (args) => {
    const a = args as {
      source_flow_id: string;
      goto: string;
      condition?: ExitPath["condition"];
    };
    if (!flowExists(a.source_flow_id)) {
      return { ok: false, error: `source flow not found: ${a.source_flow_id}` };
    }
    const isKeyword = isEndGoto(a.goto) || isReturnGoto(a.goto);
    if (!isKeyword && !flowExists(a.goto)) {
      return { ok: false, error: `goto flow not found: ${a.goto}` };
    }
    const s = store();
    const target = isKeyword ? null : a.goto;
    const xpId = s.addExitPath(a.source_flow_id, target);
    if (!xpId) return { ok: false, error: "failed to create exit path" };
    const patch: Partial<ExitPath> = {};
    if (isReturnGoto(a.goto)) patch.goto = GOTO_RETURN;
    else if (isEndGoto(a.goto)) patch.goto = GOTO_END;
    if (a.condition) patch.condition = a.condition;
    if (Object.keys(patch).length > 0) {
      s.updateExitPath(a.source_flow_id, xpId, patch);
    }
    // Keyword gotos (END/RETURN) render no edge, so glow the source flow
    // instead — otherwise the change would be invisible.
    if (isKeyword) marks().markFlow(a.source_flow_id);
    else marks().markEdge(`${a.source_flow_id}__${xpId}`);
    return { ok: true, data: { exit_path_id: xpId } };
  },
};

const deleteExitPathTool: Tool = {
  definition: {
    name: "delete_exit_path",
    description: "Delete an exit path from a flow.",
    parameters: {
      type: "object",
      properties: {
        flow_id: { type: "string" },
        exit_path_id: { type: "string" },
      },
      required: ["flow_id", "exit_path_id"],
    },
  },
  impl: (args) => {
    const { flow_id, exit_path_id } = args as {
      flow_id: string;
      exit_path_id: string;
    };
    if (!flowExists(flow_id)) return { ok: false, error: `flow not found: ${flow_id}` };
    store().removeExitPath(flow_id, exit_path_id);
    // The edge is gone; the source flow is the visible remnant of the change.
    marks().markFlow(flow_id);
    return { ok: true };
  },
};

const updateExitPathTool: Tool = {
  definition: {
    name: "update_exit_path",
    description: "Patch fields on an existing exit path.",
    parameters: {
      type: "object",
      properties: {
        flow_id: { type: "string" },
        exit_path_id: { type: "string" },
        patch: ExitPathPatchSchema,
      },
      required: ["flow_id", "exit_path_id", "patch"],
    },
  },
  impl: (args) => {
    const { flow_id, exit_path_id, patch } = args as {
      flow_id: string;
      exit_path_id: string;
      patch: Partial<ExitPath>;
    };
    if (!flowExists(flow_id)) return { ok: false, error: `flow not found: ${flow_id}` };
    store().updateExitPath(flow_id, exit_path_id, patch);
    // Re-routing to END/RETURN removes the edge from the canvas; fall back to
    // glowing the source flow so the change stays visible.
    if (patch.goto !== undefined && (isEndGoto(patch.goto) || isReturnGoto(patch.goto))) {
      marks().markFlow(flow_id);
    } else {
      marks().markEdge(`${flow_id}__${exit_path_id}`);
    }
    return { ok: true };
  },
};

const updateAgentTool: Tool = {
  definition: {
    name: "update_agent",
    description:
      "Patch agent-level fields (meta, chatbot_initiates, entry_flow_id, guardrails, variables, capabilities, knowledge).",
    parameters: {
      type: "object",
      properties: { patch: AgentPatchSchema },
      required: ["patch"],
    },
  },
  impl: (args) => {
    const { patch } = args as { patch: Partial<Agent> };
    store().updateAgent(patch);
    // The only agent-level field with a canvas footprint is the entry badge.
    if (patch.entry_flow_id) marks().markFlow(patch.entry_flow_id);
    return { ok: true };
  },
};

export const tools: Tool[] = [
  createFlowTool,
  deleteFlowTool,
  updateFlowTool,
  addExitPathTool,
  deleteExitPathTool,
  updateExitPathTool,
  updateAgentTool,
  // Read-only git/GitHub tools (diff, log, branches) — defined separately
  // because they touch the GitHub client + project stores, not the spec store.
  ...gitTools,
  // Testing-artifact CRUD (personas, cases, rubrics, golds) — defined
  // separately because they touch the tests store, not the spec store.
  ...testTools,
];

export const toolDefinitions: ToolDefinition[] = tools.map((t) => t.definition);

export function findTool(name: string): Tool | undefined {
  return tools.find((t) => t.definition.name === name);
}
