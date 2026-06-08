import { chat } from "@flowstore/core/llm/dispatch";
import type { ProviderId } from "@flowstore/core/llm/types";
import { type Modality, type Spec, channelLabel } from "@flowstore/core/schema/v0";
import { agentContextPreamble } from "./llmJson";

// Deterministic frame appended to the generated identity prompt. It's part of
// the stored, editable persona prompt (not injected at simulate time) so the
// author sees exactly what runs. Minimal, transparent rules — only what the
// user-simulator needs: stay in the user's role, the channel, junk input, and
// the stop signal.
//
// DESIGN NOTE — frame is a generate-time DEFAULT, not a runtime GUARANTEE.
// Appending here (vs. injecting in generatePersonaTurn) was a deliberate choice
// for transparency: the prompt the author edits is exactly the prompt that runs.
// The tradeoff: a persona that wasn't produced by this generator — hand-authored,
// pre-existing fixtures, or any loaded from another repo — runs WITHOUT this
// frame ("naked"). So the role-lock and empty-input handling below are best-effort
// defaults for generated personas, not invariants enforced for every run.
//
// The original motivation for the frame was runtime robustness (small models
// drift out of role / choke on empty input). A considered alternative ("option
// B") keeps identity + [DONE] here but moves role-lock + empty-input handling
// into a thin, always-applied rail in generatePersonaTurn — giving both
// transparency and a guarantee. We DEFERRED it intentionally: current hand-
// authored personas already encode role/style in prose, so nothing is broken
// today, and we favored keeping the prompt fully WYSIWYG. Revisit if naked
// personas (especially on small models) start misbehaving.
export function personaFrame(modality: Modality): string {
  return [
    "How to play this part:",
    "- Speak only as this user. Never write the agent's lines, answer your own questions, or narrate.",
    `- This is ${channelLabel(modality)}. Talk the way a real person would on it.`,
    '- If a message you receive is empty or unclear, react naturally as the user would (e.g. "Hello?", "Sorry, I didn\'t catch that").',
    "- Emit [DONE] on its own line once the conversation has wrapped up — after any final confirmations or thanks — or if you give up.",
  ].join("\n");
}

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

  // Append the frame deterministically so the stored prompt is complete and
  // transparent — what the author sees in the editor is exactly what runs.
  const identity = res.text
    .trim()
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/\s*```$/i, "");
  return `${identity}\n\n${personaFrame(spec.agent.meta.modality)}`;
}
