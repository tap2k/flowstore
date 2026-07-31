import type { ProviderId } from "../llm/types";
import { generateStructuredJson } from "./structuredOutput";
export { extractLooseJson } from "./jsonRecovery";

// Batched transcript translation — a thin consumer of the shared
// structured-output dispatch (Gemini/OpenAI strict schema, validated chat +
// corrective retry elsewhere). One call for the whole batch; items
// round-trip by id so dropped or reordered entries degrade gracefully
// (caller falls back to the original text on missing keys).

export interface TranslateItem {
  id: string;
  text: string;
}

// Dispatch-shaped credentials — mirrors what the surfaces' resolveDispatch
// returns, so callers pass it straight through.
export interface TranslateDispatch {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  wireModel: string;
}

const TRANSLATE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      translation: { type: "STRING" },
    },
    required: ["id", "translation"],
  },
};

export async function translateBatch(
  items: TranslateItem[],
  dispatch: TranslateDispatch,
): Promise<Record<string, string>> {
  if (items.length === 0) return {};
  const arr = await generateStructuredJson<Array<{ id: string; translation: string }>>(
    dispatch.provider,
    dispatch.apiKey,
    dispatch.wireModel,
    {
      baseUrl: dispatch.baseUrl,
      systemPrompt:
        'Translate the "text" field of each item to English, preserving each "id" exactly.',
      userPrompt: JSON.stringify(items),
      responseSchema: TRANSLATE_SCHEMA,
    },
  );
  return Object.fromEntries(arr.map((x) => [x.id, x.translation]));
}
