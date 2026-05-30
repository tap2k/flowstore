import type { Spec } from "@flowstore/core/schema/v0";
import type { Persona } from "@flowstore/core/schema/files/persona";
import type { MockBehavior } from "@flowstore/core/schema/files/mockBehavior";

// Translate between the persona file shape (mocks keyed by capability ID,
// vars inline) and the runtime simulate-store shape (mockReturns and
// mockErrors both keyed by capability NAME, contextVars inline). Spec is
// the id ↔ name registry. Test cases bind a persona for their world; the
// persona's system_prompt is only consumed for persona-driven runs (no
// user_turns).

export interface RuntimePersonaWorld {
  vars: Record<string, unknown>;
  returns: Record<string, Record<string, unknown>>;
  errors: Record<string, string | null>;
}

// Persona → runtime. Every capability in the spec gets an entry in
// `errors` (null for caps not in persona.mocks) so callers can clear stale
// state when hydrating from a new persona.
export function personaToRuntime(
  spec: Spec,
  persona: Persona,
): RuntimePersonaWorld {
  const idToName = new Map<string, string>();
  for (const cap of spec.agent.capabilities ?? []) idToName.set(cap.id, cap.name);

  const outVars = persona.vars ?? {};
  const returns: Record<string, Record<string, unknown>> = {};
  const errors: Record<string, string | null> = {};
  for (const cap of spec.agent.capabilities ?? []) errors[cap.name] = null;

  for (const [capId, behavior] of Object.entries(persona.mocks ?? {})) {
    const name = idToName.get(capId);
    if (!name) continue;
    if (behavior.kind === "error") {
      errors[name] = behavior.error;
    } else if (
      typeof behavior.returns === "object" &&
      behavior.returns !== null &&
      !Array.isArray(behavior.returns)
    ) {
      returns[name] = behavior.returns as Record<string, unknown>;
    }
  }
  return { vars: outVars, returns, errors };
}

// Runtime mockReturns + mockErrors → persona.mocks shape (keyed by cap ID).
// Drops empty-returns entries (the runner treats presence-of-key as "use
// this mock", so an empty entry would shadow the real endpoint).
export function runtimeToPersonaMocks(
  spec: Spec,
  returns: Record<string, Record<string, unknown>>,
  errors: Record<string, string>,
): Record<string, MockBehavior> {
  const nameToId = new Map<string, string>();
  for (const cap of spec.agent.capabilities ?? []) nameToId.set(cap.name, cap.id);

  const out: Record<string, MockBehavior> = {};
  for (const cap of spec.agent.capabilities ?? []) {
    const cid = nameToId.get(cap.name);
    if (!cid) continue;
    const err = errors[cap.name];
    if (err !== undefined && err !== null && err !== "") {
      out[cid] = { kind: "error", error: err };
      continue;
    }
    const caps = returns[cap.name] ?? {};
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(caps)) {
      if (v === undefined || v === null || v === "") continue;
      cleaned[k] = v;
    }
    if (Object.keys(cleaned).length > 0) {
      out[cid] = { kind: "static", returns: cleaned };
    }
  }
  return out;
}

// Same as runtimeToPersonaMocks but emits a full Persona from the runtime
// state. Used at "save" / "save as" time when persisting a Simulate-tab
// buffer back to a persona file. system_prompt is omitted from the output
// when blank — world-only personas are valid.
export interface BuildPersonaInput {
  spec: Spec;
  id: string;
  name?: string;
  notes?: string;
  systemPrompt: string;
  vars: Record<string, unknown>;
  returns: Record<string, Record<string, unknown>>;
  errors: Record<string, string>;
  model?: string;
}

export function buildPersonaFromRuntime(input: BuildPersonaInput): Persona {
  const { spec, id, name, notes, systemPrompt, vars, returns, errors, model } = input;
  const cleanedVars: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined || v === null || v === "") continue;
    cleanedVars[k] = v;
  }
  const mocks = runtimeToPersonaMocks(spec, returns, errors);
  const trimmedPrompt = systemPrompt.trim();
  return {
    $schema: "flowstore://test/persona/v0",
    id,
    ...(trimmedPrompt ? { system_prompt: systemPrompt } : {}),
    ...(name && name.trim() ? { name: name.trim() } : {}),
    ...(notes && notes.trim() ? { notes: notes.trim() } : {}),
    ...(model ? { model } : {}),
    ...(Object.keys(cleanedVars).length > 0 ? { vars: cleanedVars } : {}),
    ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
  };
}
