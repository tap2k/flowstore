import type { Spec } from "@flowstore/core/schema/v0";
import type { ScenarioMockBehavior } from "@flowstore/core/schema/files/scenario";
import { collectDeclaredVariables } from "./contextVars";
import { collectMockableCapabilities } from "./capabilityMocks";
import { generateContextVars } from "./contextVarsGen";
import { generateCapabilityMocks } from "./capabilityMocksGen";
import { runtimeToScenarioMocks } from "./scenarioRuntime";

// One-shot generator for both vars and mocks of a scenario. Vars come
// first so the mock generator can ground its returns against them
// (e.g., `cap_verify_policy.returns.policyholder_name` matches the
// generated `caller_name`). Mocks are returned in the scenario shape
// (keyed by capability ID) ready to inline into a Scenario.
export async function generateScenarioContent(
  spec: Spec,
  apiKey: string,
  model: string,
  scenarioContext?: { name?: string; notes?: string },
): Promise<{
  vars: Record<string, unknown>;
  mocks: Record<string, ScenarioMockBehavior>;
}> {
  const declared = collectDeclaredVariables(spec);
  const caps = collectMockableCapabilities(spec);
  const vars =
    declared.length > 0
      ? await generateContextVars(spec, apiKey, model, declared, scenarioContext)
      : {};
  const runtimeMockReturns =
    caps.length > 0
      ? await generateCapabilityMocks(
          spec,
          apiKey,
          model,
          caps,
          vars,
          scenarioContext,
        )
      : {};
  // Translate runtime returns (cap name → cap id) into scenario shape.
  const mocks = runtimeToScenarioMocks(spec, runtimeMockReturns, {});
  return { vars, mocks };
}
