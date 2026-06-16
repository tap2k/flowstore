import { generateStructuredJson } from "./structuredOutput";
import type { ProviderId } from "@flowstore/core/llm/types";

export interface GoldTurnVerdict {
  equivalent: boolean;
  note: string;
}

const SYSTEM_PROMPT =
  "You are an impartial judge comparing two agent responses in a conversation. " +
  "Determine whether they convey the same intent, commitment, and information — " +
  "even if the phrasing, language, or word choice differs.";

const USER_PROMPT_TEMPLATE = `Gold (reference) agent turn:
{gold}

Live (actual) agent turn:
{live}

Do these two agent responses convey the same intent and commitment? Consider meaning, not exact wording. Cross-language equivalence counts as equivalent.`;

export async function judgeGoldTurn(args: {
  goldTurn: string;
  liveTurn: string;
  provider: ProviderId;
  apiKey: string;
  model: string;
}): Promise<GoldTurnVerdict> {
  const { goldTurn, liveTurn, provider, apiKey, model } = args;
  const userPrompt = USER_PROMPT_TEMPLATE.replace("{gold}", goldTurn).replace(
    "{live}",
    liveTurn,
  );
  try {
    const parsed = await generateStructuredJson<{ equivalent: boolean; note: string }>(
      provider,
      apiKey,
      model,
      {
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        responseSchema: {
          type: "OBJECT",
          properties: {
            equivalent: { type: "BOOLEAN" },
            note: { type: "STRING" },
          },
          required: ["equivalent", "note"],
        },
      },
    );
    return { equivalent: parsed.equivalent, note: parsed.note };
  } catch (e) {
    return {
      equivalent: false,
      note: `judge error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
