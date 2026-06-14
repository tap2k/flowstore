import { chat } from "@flowstore/core/llm/dispatch";
import type { ProviderId } from "@flowstore/core/llm/types";
import type { Spec, VariableDecl } from "@flowstore/core/schema/v0";
import { agentContextPreamble } from "./llmJson";
import type { RouteResult } from "./routeToTarget";

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

// ─────────────────────────────────────────────────────────────────────────────
// Route-targeted persona: invert the conditions along a route into a goal-driven
// user. The LLM does the prose inversion (router-POV condition → user action) —
// its strength. The fixture (vars/mocks) is NOT the LLM's job: world state that
// gates a route is derived deterministically by the caller
// (deriveFixtureFromRoute), which is provable and trustworthy where the LLM
// would only guess. So this returns plain text (portable across every provider,
// unlike structured output) and the behavioral rail is applied at run time like
// every other persona.
// ─────────────────────────────────────────────────────────────────────────────

const ROUTE_SYSTEM_PROMPT = `You write a system prompt for an LLM that will roleplay the USER side of a conversation with an agent under test.

You are given the ordered conditions a router checks to walk a conversation to a target point. Each condition is written from the agent/router's point of view ("the user has provided a size"). Invert them into what the USER must DO, in order, and what to AVOID so the conversation doesn't branch elsewhere.

The output is a system prompt addressed to the user-LLM (second person "You are…"). It should:
- Define who the user is in one or two plausible sentences, grounded in the agent's purpose.
- Give them a goal that walks the route: do the positive conditions in order; never volunteer or agree to the things listed as "avoid".
- Stay natural — a real customer with that goal, not a tester reciting steps.

Do NOT reference guardrails, evaluation, routing, or "conditions" in the text. Do NOT specify output format, restate staying in character, or mention the channel — those are enforced separately. Keep it under 200 words.

Return ONLY the system prompt text. No commentary, no markdown fence, no preamble.`;

function describeConditionsForRoute(route: RouteResult, spec: Spec): string {
  const positives = route.llmConditions.filter((c) => !c.negative).map((c) => c.condition.expression);
  const avoids = route.llmConditions.filter((c) => c.negative).map((c) => c.condition.expression);
  // Structural conditions are world-state, not user actions — surface them so
  // the persona is consistent with the deterministically-seeded vars (the agent
  // may reference them), but they're not steps the user performs.
  const worldState = route.structuralConditions
    .filter((c) => !c.negative)
    .map((c) => c.condition.expression);

  const target = route.targetExit
    ? `${route.targetFlowName ?? route.target.flowId} → take the "${route.targetExit.notes ?? route.targetExit.condition?.expression ?? route.targetExit.id}" branch`
    : route.targetFlowName ?? route.target.flowId;

  const decls = spec.agent.variables ?? {};
  const declLines = Object.entries(decls as Record<string, VariableDecl>)
    .map(([k, d]) => `- ${k}${d.type ? ` (${d.type})` : ""}${d.description ? `: ${d.description}` : ""}`)
    .join("\n");

  return [
    `Target to reach: ${target}`,
    "",
    positives.length ? `Do these, in order:\n${positives.map((p) => `- ${p}`).join("\n")}` : "No user actions needed to reach the target.",
    avoids.length ? `\nAvoid (these send the conversation elsewhere):\n${avoids.map((a) => `- ${a}`).join("\n")}` : "",
    worldState.length ? `\nWorld state already true for this route (don't act these out; the agent just knows them):\n${worldState.map((w) => `- ${w}`).join("\n")}` : "",
    declLines ? `\nDeclared variables (for context):\n${declLines}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateRoutePersona(args: {
  spec: Spec;
  route: RouteResult;
  provider: ProviderId;
  apiKey: string;
  model: string;
}): Promise<string> {
  const { spec, route, provider, apiKey, model } = args;

  const userPrompt = [
    ...agentContextPreamble(spec),
    "",
    describeConditionsForRoute(route, spec),
    "",
    "Write the persona system prompt now.",
  ].join("\n");

  const res = await chat(provider, apiKey, model, {
    systemPrompt: ROUTE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    tools: [],
  });

  return res.text
    .trim()
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/\s*```$/i, "");
}
