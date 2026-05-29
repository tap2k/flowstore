import type { Spec } from "@flowstore/core/schema/v0";
import type { TestingArtifacts } from "@flowstore/core/files/types";

export type TestingIssueLocation =
  | { kind: "test_case"; id: string }
  | { kind: "persona"; id: string }
  | { kind: "rubric"; id: string }
  | { kind: "scenario"; id: string };

export interface TestingIssue {
  at: TestingIssueLocation;
  message: string;
}

// Cross-file checks across testing artifacts and the spec:
//   - scenario.mocks keys refer to known capabilities
//   - persona.default_scenario_id refers to an existing scenario
//   - test_case.persona_id refers to a known persona
//   - test_case.scenario_id refers to a known scenario
//   - test_case.capability_assertions[].capability refers to a known capability
//   - duplicate ids within each collection
export function validateTesting(
  spec: Spec | null,
  artifacts: TestingArtifacts,
): TestingIssue[] {
  const issues: TestingIssue[] = [];

  const capabilityIds = new Set((spec?.agent.capabilities ?? []).map((c) => c.id));

  const personaIds = new Set<string>();
  for (const p of artifacts.personas) {
    if (personaIds.has(p.id)) {
      issues.push({ at: { kind: "persona", id: p.id }, message: "Duplicate persona id" });
    } else {
      personaIds.add(p.id);
    }
  }

  const scenarioIds = new Set<string>();
  for (const s of artifacts.scenarios) {
    if (scenarioIds.has(s.id)) {
      issues.push({ at: { kind: "scenario", id: s.id }, message: "Duplicate scenario id" });
    } else {
      scenarioIds.add(s.id);
    }
    for (const capId of Object.keys(s.mocks ?? {})) {
      if (spec && !capabilityIds.has(capId)) {
        issues.push({
          at: { kind: "scenario", id: s.id },
          message: `mocks key "${capId}" is not in agent.capabilities`,
        });
      }
    }
  }

  for (const p of artifacts.personas) {
    if (p.default_scenario_id && !scenarioIds.has(p.default_scenario_id)) {
      issues.push({
        at: { kind: "persona", id: p.id },
        message: `default_scenario_id "${p.default_scenario_id}" not in tests/scenarios/`,
      });
    }
  }

  const testIds = new Set<string>();
  const rubricIds = new Set<string>();
  for (const r of artifacts.rubrics) {
    if (rubricIds.has(r.id)) {
      issues.push({ at: { kind: "rubric", id: r.id }, message: "Duplicate rubric id" });
    } else {
      rubricIds.add(r.id);
    }
  }

  for (const t of artifacts.testCases) {
    if (testIds.has(t.id)) {
      issues.push({ at: { kind: "test_case", id: t.id }, message: "Duplicate test case id" });
    } else {
      testIds.add(t.id);
    }
    const hasTurns = Array.isArray(t.user_turns);
    const hasPersona = typeof t.persona_id === "string";
    if (!hasTurns && !hasPersona) {
      issues.push({
        at: { kind: "test_case", id: t.id },
        message: "must have user_turns (scripted) or persona_id (persona-driven)",
      });
    }
    if (hasTurns && hasPersona) {
      issues.push({
        at: { kind: "test_case", id: t.id },
        message: "must not have both user_turns and persona_id — pick one shape",
      });
    }
    if (t.max_turns !== undefined && hasTurns) {
      issues.push({
        at: { kind: "test_case", id: t.id },
        message: "max_turns is only meaningful for persona-driven cases; user_turns is its own implicit cap",
      });
    }
    if (t.persona_id && !personaIds.has(t.persona_id)) {
      issues.push({
        at: { kind: "test_case", id: t.id },
        message: `persona_id "${t.persona_id}" not in tests/personas/`,
      });
    }
    if (t.scenario_id && !scenarioIds.has(t.scenario_id)) {
      issues.push({
        at: { kind: "test_case", id: t.id },
        message: `scenario_id "${t.scenario_id}" not in tests/scenarios/`,
      });
    }
    for (const ca of t.capability_assertions ?? []) {
      if (spec && !capabilityIds.has(ca.capability)) {
        issues.push({
          at: { kind: "test_case", id: t.id },
          message: `capability_assertions refers to unknown capability "${ca.capability}"`,
        });
      }
    }
  }

  return issues;
}
