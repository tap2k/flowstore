import type { Spec } from "@flowstore/core/schema/v0";
import type { MockBehavior } from "@flowstore/core/schema/files/mockBehavior";
import type { ProviderId } from "@flowstore/core/llm/types";
import { collectDeclaredVariables } from "./contextVars";
import { collectMockableCapabilities } from "./capabilityMocks";
import { generateContextVars } from "./contextVarsGen";
import { generateCapabilityMocks } from "./capabilityMocksGen";
import { generatePersonaPrompt } from "./personaGen";
import { runtimeToPersonaMocks } from "./personaRuntime";

// One-shot generator for the full persona content — system_prompt + vars +
// mocks. Vars first so the mock generator can ground returns against them
// (e.g. cap_verify_policy.returns.policyholder_name matches the generated
// caller_name); persona system prompt last so it can reference the chosen
// world. Mocks are returned in the persona shape (keyed by capability ID)
// ready to inline onto a Persona.
//
// personaContext (name + notes) is optional — when absent, the system
// prompt grounds purely against agent.purpose + business_goals (the same
// fallback path the run-pill Generate-without-name+notes flow uses).
export async function generatePersonaContent(
  spec: Spec,
  provider: ProviderId,
  apiKey: string,
  model: string,
  personaContext?: { name?: string; notes?: string },
): Promise<{
  systemPrompt: string;
  vars: Record<string, unknown>;
  mocks: Record<string, MockBehavior>;
}> {
  const declared = collectDeclaredVariables(spec);
  const caps = collectMockableCapabilities(spec);
  const vars =
    declared.length > 0
      ? await generateContextVars(spec, provider, apiKey, model, declared, personaContext)
      : {};
  const runtimeMockReturns =
    caps.length > 0
      ? await generateCapabilityMocks(
          spec,
          provider,
          apiKey,
          model,
          caps,
          vars,
          personaContext,
        )
      : {};
  const mocks = runtimeToPersonaMocks(spec, runtimeMockReturns, {});
  const systemPrompt = await generatePersonaPrompt({
    spec,
    contextVars: vars,
    provider,
    apiKey,
    model,
    personaContext,
  });
  return { systemPrompt, vars, mocks };
}
