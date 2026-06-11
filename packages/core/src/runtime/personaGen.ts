import { chat } from "@flowstore/core/llm/dispatch";
import type { ProviderId } from "@flowstore/core/llm/types";
import type { Spec } from "@flowstore/core/schema/v0";
import { agentContextPreamble } from "./llmJson";

// A generated persona is DECLARATIVE: identity + scenario only ("who is this
// user and why are they contacting the agent"). The medium-aware behavioral
// rail (role-lock, length, empty-input handling, [DONE]) is NOT baked in here —
// it's composed at run time by whoever drives the persona, since how faithfully
// a user is simulated on voice vs text is a runtime concern, not portable spec
// data. See defaultPersonaInstructions in personaClient.ts.

const SYSTEM_PROMPT = `You write a system prompt for an LLM that will roleplay the USER side of a conversation with an agent under test.

The output is a system prompt addressed to that user-LLM (second person: "You are…"). It should:
- Define who the user is in one or two sentences — plausible name and situation, grounded in the agent's purpose and any variables already provided.
- Give the user a specific reason they're contacting the agent right now — a concrete situation that probes one of the agent's intended outcomes.
- Suggest a brief interaction style (terse/verbose, patient/impatient, precise/vague) — pick one that produces useful test friction.

Do NOT reference guardrails, evaluation criteria, or test framing — the persona should behave like a real customer, not a tester. Do NOT specify output format, restate that the model must stay in character, or mention the channel (voice vs text) — those invariants are enforced separately at run time. Keep the prompt under 200 words.

Return ONLY the system prompt text. No commentary, no markdown fence, no preamble.`;

export async function generatePersonaPrompt(args: {
  spec: Spec;
  contextVars: Record<string, unknown>;
  provider: ProviderId;
  apiKey: string;
  model: string;
  personaContext?: { name?: string; notes?: string };
}): Promise<string> {
  const { spec, contextVars, provider, apiKey, model, personaContext } = args;

  const goals = (spec.agent.business_goals ?? [])
    .map((g) => `- ${g.name}`)
    .join("\n");

  const filledVars = Object.entries(contextVars)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
    .join("\n");

  const personaPreamble = personaContext && (personaContext.name || personaContext.notes)
    ? [
        "Persona you're writing FOR:",
        personaContext.name ? `  Name: ${personaContext.name}` : null,
        personaContext.notes ? `  Notes: ${personaContext.notes}` : null,
        "Ground the persona prompt in this description.",
        "",
      ].filter((s) => s !== null) as string[]
    : [];

  const userPrompt = [
    ...agentContextPreamble(spec),
    "",
    ...personaPreamble,
    goals ? `Outcomes the agent is judged against (pick one for the persona to want):\n${goals}` : null,
    "",
    filledVars
      ? `Variables already chosen for this run — the persona IS this person:\n${filledVars}`
      : `No variables are filled. Invent plausible specifics in the prompt.`,
    "",
    `Write the persona system prompt now.`,
  ]
    .filter((s) => s !== null)
    .join("\n");

  const res = await chat(provider, apiKey, model, {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    tools: [],
  });

  // Identity + scenario only. The behavioral rail is applied at run time
  // (defaultPersonaInstructions), so the stored persona stays declarative.
  return res.text
    .trim()
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/\s*```$/i, "");
}
