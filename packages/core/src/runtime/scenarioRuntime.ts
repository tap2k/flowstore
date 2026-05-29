import type { Spec } from "@flowstore/core/schema/v0";
import type {
  Scenario,
  ScenarioMockBehavior,
} from "@flowstore/core/schema/files/scenario";

// Translate between the scenario file shape (mocks keyed by capability ID,
// vars inline) and the runtime simulate-store shape (mockReturns and
// mockErrors both keyed by capability NAME, contextVars inline). Spec is
// the id ↔ name registry.

export interface RuntimeScenarioState {
  vars: Record<string, unknown>;
  returns: Record<string, Record<string, unknown>>;
  errors: Record<string, string | null>;
}

// Scenario → runtime. Every capability in the spec gets an entry in
// `errors` (null for caps not in scenario.mocks) so callers can clear stale
// state when hydrating from a new scenario.
export function scenarioToRuntime(
  spec: Spec,
  scenario: Scenario,
): RuntimeScenarioState {
  const idToName = new Map<string, string>();
  for (const cap of spec.agent.capabilities ?? []) idToName.set(cap.id, cap.name);

  const vars = scenario.vars ?? {};
  const returns: Record<string, Record<string, unknown>> = {};
  const errors: Record<string, string | null> = {};
  for (const cap of spec.agent.capabilities ?? []) errors[cap.name] = null;

  for (const [capId, behavior] of Object.entries(scenario.mocks ?? {})) {
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
  return { vars, returns, errors };
}

// Runtime mockReturns + mockErrors → scenario.mocks shape (keyed by cap ID).
// Drops empty-returns entries (the runner treats presence-of-key as "use
// this mock", so an empty entry would shadow the real endpoint).
export function runtimeToScenarioMocks(
  spec: Spec,
  returns: Record<string, Record<string, unknown>>,
  errors: Record<string, string>,
): Record<string, ScenarioMockBehavior> {
  const nameToId = new Map<string, string>();
  for (const cap of spec.agent.capabilities ?? []) nameToId.set(cap.name, cap.id);

  const out: Record<string, ScenarioMockBehavior> = {};
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

// Same as runtimeToScenarioMocks but emits a full Scenario from id + name
// + notes + the runtime state. Used at "save" / "save as" time.
export function buildScenarioFromRuntime(
  spec: Spec,
  id: string,
  name: string | undefined,
  notes: string | undefined,
  vars: Record<string, unknown>,
  returns: Record<string, Record<string, unknown>>,
  errors: Record<string, string>,
): Scenario {
  const cleanedVars: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined || v === null || v === "") continue;
    cleanedVars[k] = v;
  }
  const mocks = runtimeToScenarioMocks(spec, returns, errors);
  return {
    $schema: "flowstore://test/scenario/v0",
    id,
    ...(name && name.trim() ? { name: name.trim() } : {}),
    ...(notes && notes.trim() ? { notes: notes.trim() } : {}),
    ...(Object.keys(cleanedVars).length > 0 ? { vars: cleanedVars } : {}),
    ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
  };
}
