import type { Spec } from "@flowstore/core/schema/v0";
import type { Persona, PersonaTraits } from "@flowstore/core/schema/files/persona";
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

// A fixture is the vars + per-capability mocks an artifact carries. Personas
// carry the character-intrinsic fixture; cases / decision tests carry the
// situational fixture.
export interface Fixture {
  vars?: Record<string, unknown>;
  mocks?: Record<string, MockBehavior>;
}

// Effective fixture for a persona-bound case = `persona ∪ case`. vars merge
// per key; mocks replace per capability id; the case always wins. A scripted
// or inline-prompt case (no persona) resolves to just its own fixture — pass
// `undefined` for the persona.
export function resolveFixture(
  persona: Fixture | undefined,
  testCase: Fixture,
): { vars: Record<string, unknown>; mocks: Record<string, MockBehavior> } {
  return {
    vars: { ...(persona?.vars ?? {}), ...(testCase.vars ?? {}) },
    mocks: { ...(persona?.mocks ?? {}), ...(testCase.mocks ?? {}) },
  };
}

// Fixture (vars + mocks keyed by capability id) → runtime simulate-store
// shape (mockReturns/mockErrors keyed by capability NAME). Every capability in
// the spec gets an entry in `errors` (null when unmocked) so callers can clear
// stale state when hydrating.
export function fixtureToRuntime(spec: Spec, fixture: Fixture): RuntimePersonaWorld {
  const idToName = new Map<string, string>();
  for (const cap of spec.agent.capabilities ?? []) idToName.set(cap.id, cap.name);

  const outVars = fixture.vars ?? {};
  const returns: Record<string, Record<string, unknown>> = {};
  const errors: Record<string, string | null> = {};
  for (const cap of spec.agent.capabilities ?? []) errors[cap.name] = null;

  for (const [capId, behavior] of Object.entries(fixture.mocks ?? {})) {
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

// Persona → runtime (its intrinsic fixture alone). Used when hydrating the
// Simulate buffer directly from a persona, with no case context.
export function personaToRuntime(
  spec: Spec,
  persona: Persona,
): RuntimePersonaWorld {
  return fixtureToRuntime(spec, { vars: persona.vars, mocks: persona.mocks });
}

// Case → runtime, resolving `persona ∪ case`. Pass the bound persona (if any).
export function caseWorldToRuntime(
  spec: Spec,
  persona: Fixture | undefined,
  testCase: Fixture,
): RuntimePersonaWorld {
  return fixtureToRuntime(spec, resolveFixture(persona, testCase));
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
// buffer back to a persona file. system_prompt is always written (it's
// required — a persona is an actor); the caller is responsible for ensuring
// it's non-empty before this becomes a committed persona.
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
  // Machine-read behavioral knobs (asr, barge_in). The caller drops no-op
  // entries (off / 0) before passing them.
  traits?: PersonaTraits;
}

export function buildPersonaFromRuntime(input: BuildPersonaInput): Persona {
  const { spec, id, name, notes, systemPrompt, vars, returns, errors, model, traits } = input;
  const cleanedVars: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined || v === null || v === "") continue;
    cleanedVars[k] = v;
  }
  const mocks = runtimeToPersonaMocks(spec, returns, errors);
  return {
    $schema: "flowstore://test/persona/v0",
    id,
    system_prompt: systemPrompt,
    ...(name && name.trim() ? { name: name.trim() } : {}),
    ...(notes && notes.trim() ? { notes: notes.trim() } : {}),
    ...(model ? { model } : {}),
    ...(Object.keys(cleanedVars).length > 0 ? { vars: cleanedVars } : {}),
    ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
    ...(traits && Object.keys(traits).length > 0 ? { traits } : {}),
  };
}
