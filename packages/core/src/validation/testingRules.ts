import type { Spec } from "@flowstore/core/schema/v0";
import type { TestingArtifacts } from "@flowstore/core/files/types";

export type TestingIssueLocation =
  | { kind: "test_case"; id: string }
  | { kind: "persona"; id: string }
  | { kind: "rubric"; id: string };

export interface TestingIssue {
  at: TestingIssueLocation;
  message: string;
}

// Cross-file checks across testing artifacts and the spec:
//   - persona.mocks keys refer to known capabilities
//   - test_case.persona_id refers to a known persona
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
    for (const capId of Object.keys(p.mocks ?? {})) {
      if (spec && !capabilityIds.has(capId)) {
        issues.push({
          at: { kind: "persona", id: p.id },
          message: `mocks key "${capId}" is not in agent.capabilities`,
        });
      }
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
        message: "must have user_turns (scripted) or persona_id (persona-driven, or scripted with a bound persona for the world)",
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
