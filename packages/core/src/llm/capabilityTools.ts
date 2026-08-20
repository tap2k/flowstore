import type { Capability, Spec, VariableDecl } from "@flowstore/core/schema/v0";
import type { ToolDefinition } from "@flowstore/core/llm/types";

// THE capability → tool-schema builder. Every surface that hands capability
// tools to an LLM (flowstore-compile --format prompt, the simulator) goes
// through here, so schema policy is decided once. The policy:
//
// No `required` list. On LLM-filled args, `required` never creates
// information — it converts detectable absence into fabrication (the ADAPT
// pilot's "not provided" caller_phone reached a caller-identity key). What
// must be collected is conversation behavior and lives in the flows; the
// tool schema only describes shapes.
//
// `closed` emits `additionalProperties: false` — for compile targets whose
// consumers accept it. Default off: Gemini Live's OpenAPI-3.0 subset rejects
// the keyword (see browser lib/chat/tools.ts), and the simulator feeds
// Gemini directly.

// JSON-schema fragment for a single input, from its declared variable type.
// Unknown/undeclared types fall back to string.
export function jsonSchemaForDecl(decl?: VariableDecl): Record<string, unknown> {
  const schema: Record<string, unknown> =
    decl?.type === "number"
      ? { type: "number" }
      : decl?.type === "boolean"
        ? { type: "boolean" }
        : decl?.type === "enum"
          ? { type: "string", ...(decl.values?.length ? { enum: decl.values } : {}) }
          : { type: "string" };
  if (decl?.description) schema.description = decl.description;
  return schema;
}

// Agent-level declarations first, then flow-level — capability inputs may be
// declared on the flow that collects them.
export function lookupDecl(spec: Spec, name: string): VariableDecl | undefined {
  const fromAgent = spec.agent.variables?.[name];
  if (fromAgent) return fromAgent;
  for (const flow of spec.flows ?? []) {
    const fromFlow = flow.variables?.[name];
    if (fromFlow) return fromFlow;
  }
  return undefined;
}

export function capabilityToolDefinitions(
  spec: Spec | null,
  opts: { closed?: boolean } = {},
): ToolDefinition[] {
  if (!spec) return [];
  const caps = (spec.agent.capabilities ?? []) as Capability[];
  return caps.map((cap) => {
    const properties: Record<string, unknown> = {};
    for (const name of cap.inputs ?? []) {
      properties[name] = jsonSchemaForDecl(lookupDecl(spec, name));
    }
    return {
      name: cap.name,
      description: cap.description,
      parameters: {
        type: "object",
        properties,
        ...(opts.closed ? { additionalProperties: false } : {}),
      },
    };
  });
}
