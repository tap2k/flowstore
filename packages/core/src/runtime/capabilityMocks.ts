import type { Capability, Spec, VariableDecl } from "@flowstore/core/schema/v0";
import type { ToolDefinition } from "@flowstore/core/llm/types";
import type { CapabilityEndpoint } from "@flowstore/core/files/models";
import { capabilityToolDefinitions, lookupDecl } from "@flowstore/core/llm/capabilityTools";

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

// Capabilities exposed to the LLM as tools in prompt mode. Both kinds are
// included: prompt mode has no dispatcher, so the model is the de-facto router
// and must trigger retrieval too for it to stay contextual. The tool name is
// the capability name (the key mock_returns and capability events use), so a
// call resolves straight back to its mock. Output-less capabilities are still
// exposed (pure side-effect functions) and resolve to {}. Schema shape and
// policy live in llm/capabilityTools.ts.
export function buildCapabilityTools(spec: Spec | null): ToolDefinition[] {
  return capabilityToolDefinitions(spec);
}

// Resolves a capability call to its outputs. Checks live endpoints first:
// if a URL is configured for this capability, POSTs the LLM's args to it
// and returns the JSON response. Falls back to the static mock (or error
// sentinel) when no endpoint is configured or the fetch fails.
export async function resolveMockedCall(
  capabilityName: string,
  callArgs: Record<string, unknown>,
  mockReturns: Record<string, Record<string, unknown>>,
  mockErrors: Record<string, string> = {},
  liveEndpoints: Record<string, CapabilityEndpoint> = {},
): Promise<Record<string, unknown> | { error: string }> {
  const endpoint = liveEndpoints[capabilityName];
  if (endpoint) {
    try {
      const method = endpoint.method ?? "POST";
      const body = method === "GET" ? undefined : JSON.stringify(callArgs);
      const res = await fetch(endpoint.url, {
        method,
        headers: { "Content-Type": "application/json", ...(endpoint.headers ?? {}) },
        ...(body !== undefined ? { body } : {}),
      });
      if (!res.ok) {
        return { error: `live endpoint ${res.status}: ${await res.text().catch(() => res.statusText)}` };
      }
      return (await res.json()) as Record<string, unknown>;
    } catch (e) {
      return { error: `live endpoint unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const errorMsg = mockErrors[capabilityName];
  if (errorMsg !== undefined) return { error: errorMsg };
  return mockReturns[capabilityName] ?? {};
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
