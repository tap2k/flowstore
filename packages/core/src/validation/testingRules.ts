import type { Spec } from "@flowstore/core/schema/v0";
import type { TestingArtifacts } from "@flowstore/core/files/types";

export type TestingIssueLocation =
  | { kind: "test_case"; id: string }
  | { kind: "persona"; id: string }
  | { kind: "rubric"; id: string }
  | { kind: "mock"; capabilityId: string; variant: string };

export interface TestingIssue {
  at: TestingIssueLocation;
  message: string;
}

// Cross-file checks across testing artifacts and the spec:
//   - mock.capability_id refers to a known capability
//   - test_case.persona_id refers to a known persona
//   - test_case.mock_bindings.<capability_id> refers to an existing mock variant
//   - test_case.evaluators[] — name resolution requires Python eval-file
//     enumeration we don't have here; skip in v0
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

  const testIds = new Set<string>();
  const rubricIds = new Set<string>();
  for (const r of artifacts.rubrics) {
    if (rubricIds.has(r.id)) {
      issues.push({ at: { kind: "rubric", id: r.id }, message: "Duplicate rubric id" });
    } else {
      rubricIds.add(r.id);
    }
  }

  // Index mocks by capability_id → set of variants for membership checks.
  const mockIndex = new Map<string, Set<string>>();
  for (const m of artifacts.capabilityMocks) {
    if (spec && !capabilityIds.has(m.capability_id)) {
      issues.push({
        at: { kind: "mock", capabilityId: m.capability_id, variant: m.variant },
        message: `capability_id "${m.capability_id}" not in agent.capabilities`,
      });
    }
    const variants = mockIndex.get(m.capability_id) ?? new Set();
    if (variants.has(m.variant)) {
      issues.push({
        at: { kind: "mock", capabilityId: m.capability_id, variant: m.variant },
        message: `Duplicate mock variant "${m.variant}" for capability "${m.capability_id}"`,
      });
    }
    variants.add(m.variant);
    mockIndex.set(m.capability_id, variants);
  }

  for (const t of artifacts.testCases) {
    if (testIds.has(t.id)) {
      issues.push({ at: { kind: "test_case", id: t.id }, message: "Duplicate test case id" });
    } else {
      testIds.add(t.id);
    }
    if (t.persona_id && !personaIds.has(t.persona_id)) {
      issues.push({
        at: { kind: "test_case", id: t.id },
        message: `persona_id "${t.persona_id}" not in tests/personas/`,
      });
    }
    for (const [capId, variant] of Object.entries(t.mock_bindings ?? {})) {
      if (spec && !capabilityIds.has(capId)) {
        issues.push({
          at: { kind: "test_case", id: t.id },
          message: `mock_bindings refers to unknown capability "${capId}"`,
        });
        continue;
      }
      const variants = mockIndex.get(capId);
      if (!variants || !variants.has(variant)) {
        issues.push({
          at: { kind: "test_case", id: t.id },
          message: `mock_bindings["${capId}"] = "${variant}" — no matching ${capId}.${variant}.mock.json`,
        });
      }
    }
  }

  return issues;
}
