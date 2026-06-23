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
//   - persona.mocks / test_case.mocks keys refer to known capabilities
//   - every case is scripted (user_turns) XOR actor-driven (persona_id and/or
//     system_prompt) — the binding invariant
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
    // Binding invariant: a case is EITHER scripted (user_turns) OR actor-driven
    // (an LLM-as-user). An actor-driven case names a persona, an inline
    // system_prompt, or BOTH — when both, the inline prompt is a per-scenario
    // overlay appended to the persona's (see resolveActorPrompt). Scripted is
    // exclusive with the actor fields: a fixed user script and an LLM actor
    // can't both drive the same conversation.
    const hasTurns = Array.isArray(t.user_turns);
    const hasPersona = typeof t.persona_id === "string";
    const hasInlinePrompt = typeof t.system_prompt === "string";
    const hasActor = hasPersona || hasInlinePrompt;
    if (!hasTurns && !hasActor) {
      issues.push({
        at: { kind: "test_case", id: t.id },
        message: "must carry an actor: user_turns (scripted), persona_id and/or system_prompt (LLM-as-user)",
      });
    } else if (hasTurns && hasActor) {
      issues.push({
        at: { kind: "test_case", id: t.id },
        message: "user_turns (scripted) is mutually exclusive with persona_id/system_prompt (LLM actor) — a fixed script and a live actor can't both drive the conversation",
      });
    }
    if (t.max_turns !== undefined && hasTurns) {
      issues.push({
        at: { kind: "test_case", id: t.id },
        message: "max_turns is only meaningful for simulated-user cases; user_turns is its own implicit cap",
      });
    }
    if (t.persona_id && !personaIds.has(t.persona_id)) {
      issues.push({
        at: { kind: "test_case", id: t.id },
        message: `persona_id "${t.persona_id}" not in tests/personas/`,
      });
    }
    for (const capId of Object.keys(t.mocks ?? {})) {
      if (spec && !capabilityIds.has(capId)) {
        issues.push({
          at: { kind: "test_case", id: t.id },
          message: `mocks key "${capId}" is not in agent.capabilities`,
        });
      }
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
