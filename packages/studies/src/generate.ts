import { genId } from "@flowstore/core/ids";
import { generateStructuredJson } from "@flowstore/core/runtime/structuredOutput";
import type { ModelDispatch, Scenario } from "./types";

// Machine-assist generators for the compare surface, in the translate.ts
// shape: thin consumers of the shared structured-output dispatch, credentials
// injected as ModelDispatch (the engine never reads a settings store). Both
// ground on the pasted system prompt — compare has no Spec, which is why they
// don't reuse core's Spec-coupled contextVarsGen.

const PROMPT_SLICE = 8000;

// Fill values for {{placeholder}} names in the prompt. The LLM proposes, the
// user edits — nothing runs until they say so. Returns only string-valued
// entries for the requested names; the caller merges.
export async function generateVars(
  prompt: string,
  names: string[],
  dispatch: ModelDispatch,
): Promise<Record<string, string>> {
  if (names.length === 0) return {};
  const bag = await generateStructuredJson<Record<string, string>>(
    dispatch.provider,
    dispatch.apiKey,
    dispatch.wireModel,
    {
      baseUrl: dispatch.baseUrl,
      systemPrompt:
        "You generate plausible sample values for template variables in a conversational agent's system prompt, so the prompt can be test-run. Values are short strings.",
      userPrompt: `Variables: ${names.join(", ")}\n\nSystem prompt:\n${prompt.slice(0, PROMPT_SLICE)}`,
      responseSchema: {
        type: "OBJECT",
        properties: Object.fromEntries(names.map((n) => [n, { type: "STRING" }])),
        required: names,
      },
    },
  );
  const out: Record<string, string> = {};
  for (const n of names) {
    if (typeof bag[n] === "string") out[n] = bag[n];
  }
  return out;
}

const SCENARIOS_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      name: { type: "STRING", description: "Short scenario title" },
      language: {
        type: "STRING",
        description: "Uppercase language code of the turns, e.g. EN",
      },
      turns: {
        type: "ARRAY",
        items: { type: "STRING" },
        description: "Ordered user turns, one string per turn",
      },
    },
    required: ["name", "language", "turns"],
  },
};

// Draft test scenarios from the (placeholder-filled) system prompt. Existing
// scenarios are passed as context so new ones cover different paths; returned
// scenarios carry fresh ids, ready to append.
export async function generateScenarios(
  prompt: string,
  existing: Scenario[],
  dispatch: ModelDispatch,
  count = 3,
): Promise<Scenario[]> {
  const existingNote =
    existing.length > 0
      ? `\n\nExisting scenarios (cover different paths):\n${existing
          .map((s) => `- ${s.name}: ${s.turns.filter((t) => t.trim()).join(" | ")}`)
          .join("\n")}`
      : "";
  const arr = await generateStructuredJson<
    Array<{ name: string; language: string; turns: string[] }>
  >(dispatch.provider, dispatch.apiKey, dispatch.wireModel, {
    baseUrl: dispatch.baseUrl,
    systemPrompt:
      "You write test scenarios for a conversational agent, given its system prompt. A scenario is one user's side of a conversation: 3-6 ordered turns of ONLY what the user says (the agent's replies are generated at run time, so each turn should still make sense against the agent's likely reply). Each scenario exercises a distinct path through the agent's behavior; include at least one edge case or awkward user. Write turns in the language the agent's users would use.",
    userPrompt: `Write ${count} scenarios.\n\nSystem prompt:\n${prompt.slice(0, PROMPT_SLICE)}${existingNote}`,
    responseSchema: SCENARIOS_SCHEMA,
  });
  return arr
    .filter((s) => s.name.trim() && s.turns.some((t) => t.trim()))
    .map((s) => {
      const id = genId("scenario");
      return {
        id,
        scenarioId: id,
        name: s.name.trim(),
        language: (s.language || "EN").trim().toUpperCase(),
        turns: s.turns.map((t) => t.trim()).filter(Boolean),
      };
    });
}
