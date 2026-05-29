import type { Capability, Spec, VariableDecl } from "@flowstore/core/schema/v0";
import type { ToolDefinition } from "@flowstore/core/llm/types";

export interface MockableOutput {
  name: string;
  decl?: VariableDecl;
}

export interface MockableCapability {
  capabilityName: string;
  capabilityId: string;
  description?: string;
  outputs: MockableOutput[];
}

// JSON-schema fragment for a single capability input, derived from its declared
// variable type. Unknown/undeclared types fall back to string.
function jsonSchemaForDecl(decl?: VariableDecl): Record<string, unknown> {
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

// Capabilities exposed to the LLM as tools in prompt mode. Both kinds are
// included: prompt mode has no dispatcher, so the model is the de-facto router
// and must trigger retrieval too for it to stay contextual. The tool name is
// the capability name (the key mock_returns and capability events use), so a
// call resolves straight back to its mock. Output-less capabilities are still
// exposed (pure side-effect functions) and resolve to {}.
export function buildCapabilityTools(spec: Spec | null): ToolDefinition[] {
  if (!spec) return [];
  const caps = (spec.agent.capabilities ?? []) as Capability[];
  return caps.map((cap) => {
    const inputs = cap.inputs ?? [];
    const properties: Record<string, unknown> = {};
    for (const name of inputs) properties[name] = jsonSchemaForDecl(lookupDecl(spec, name));
    return {
      name: cap.name,
      description: cap.description,
      parameters: {
        type: "object",
        properties,
        ...(inputs.length ? { required: inputs } : {}),
      },
    };
  });
}

// Resolves a capability call (by name) to its mocked outputs. If the
// capability is marked as error-behavior via mockErrors, returns a
// `{ error: string }` sentinel that promptClient detects and feeds back
// to the LLM as a tool error. Static returns otherwise; `{}` when
// neither is set.
export function resolveMockedCall(
  capabilityName: string,
  mockReturns: Record<string, Record<string, unknown>>,
  mockErrors: Record<string, string> = {},
): Record<string, unknown> | { error: string } {
  const errorMsg = mockErrors[capabilityName];
  if (errorMsg !== undefined) return { error: errorMsg };
  return mockReturns[capabilityName] ?? {};
}

function lookupDecl(spec: Spec, outputName: string): VariableDecl | undefined {
  const fromAgent = spec.agent.variables?.[outputName];
  if (fromAgent) return fromAgent;
  for (const flow of spec.flows ?? []) {
    const fromFlow = flow.variables?.[outputName];
    if (fromFlow) return fromFlow;
  }
  return undefined;
}

export function collectMockableCapabilities(spec: Spec | null): MockableCapability[] {
  if (!spec) return [];
  const caps = spec.agent.capabilities ?? [];
  const out: MockableCapability[] = [];
  for (const cap of caps as Capability[]) {
    const outputs = (cap.outputs ?? []).map((name) => ({
      name,
      decl: lookupDecl(spec, name),
    }));
    if (outputs.length === 0) continue;
    out.push({
      capabilityName: cap.name,
      capabilityId: cap.id,
      description: cap.description,
      outputs,
    });
  }
  return out;
}

// Drop empty values and fully-empty capability blocks, AND drop entries that
// don't match the current spec (capability renamed/removed, output renamed/
// removed). The runner treats presence-of-key as "use this mock", so an empty
// or stale capability entry would silently shadow the real endpoint.
export function cleanMockReturns(
  raw: Record<string, Record<string, unknown>>,
  spec: Spec | null,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const capByName = new Map<string, Capability>();
  for (const cap of (spec?.agent.capabilities ?? []) as Capability[]) {
    capByName.set(cap.name, cap);
  }
  for (const [capName, outputs] of Object.entries(raw)) {
    const cap = capByName.get(capName);
    if (!cap) continue;
    const validOutputs = new Set(cap.outputs ?? []);
    const cleaned: Record<string, unknown> = {};
    for (const [outName, value] of Object.entries(outputs)) {
      if (!validOutputs.has(outName)) continue;
      if (value === undefined || value === null || value === "") continue;
      cleaned[outName] = value;
    }
    if (Object.keys(cleaned).length === 0) continue;
    out[capName] = cleaned;
  }
  return out;
}
