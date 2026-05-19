import { chat, DEFAULT_PROVIDER } from "@/lib/llm/dispatch";
import type { Spec } from "@/lib/schema/v0";
import { agentContextPreamble } from "./llmJson";

const SYSTEM_PROMPT = `You write system prompts for an LLM that will roleplay as the USER side of a conversation with an agent under test.

The output is a system prompt addressed to that user-LLM (second person: "You are…"). It should:
- Define who the user is in one or two sentences — plausible name and situation, grounded in the agent's purpose and any variables already provided.
- Give the user a specific reason they're contacting the agent right now — a concrete situation that probes one of the agent's intended outcomes.
- Suggest a brief interaction style (terse/verbose, patient/impatient, precise/vague) — pick one that produces useful test friction.
- Instruct the model to reply ONLY as the user would say it out loud, no narration, no stage directions, no meta-commentary.
- End with: "Emit [DONE] on its own line when you have what you came for or decide to give up."

Do NOT reference guardrails, evaluation criteria, or test framing — the persona should behave like a real customer, not a tester. Keep the prompt under 200 words.

Return ONLY the system prompt text. No commentary, no markdown fence, no preamble.`;

export async function generatePersonaPrompt(args: {
  spec: Spec;
  contextVars: Record<string, unknown>;
  apiKey: string;
  model: string;
}): Promise<string> {
  const { spec, contextVars, apiKey, model } = args;

  const goals = (spec.agent.business_goals ?? [])
    .map((g) => `- ${g.name}`)
    .join("\n");

  const filledVars = Object.entries(contextVars)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
    .join("\n");

  const userPrompt = [
    ...agentContextPreamble(spec),
    "",
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

  const res = await chat(DEFAULT_PROVIDER, apiKey, model, {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    tools: [],
  });

  return res.text
    .trim()
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/\s*```$/i, "");
}
