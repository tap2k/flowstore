import { generateJsonChat } from "./chatJson";
export { extractLooseJson } from "./jsonRecovery";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export interface TranslateItem {
  id: string;
  text: string;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
}

// Batched translation via Gemini structured output. One call for the whole
// batch; items round-trip by id so dropped or reordered entries degrade
// gracefully (caller falls back to the original text on missing keys).
export async function translateBatchToEnglish(
  items: TranslateItem[],
  apiKey: string,
  model: string,
): Promise<Record<string, string>> {
  if (items.length === 0) return {};

  const body = {
    contents: [
      {
        parts: [
          {
            text:
              'Translate the "text" field of each item to English. ' +
              'Return a JSON array with one object per input, preserving each "id" exactly. ' +
              'Output only the JSON.\n\n' +
              JSON.stringify(items),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING" },
            translation: { type: "STRING" },
          },
          required: ["id", "translation"],
        },
      },
    },
  };

  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as GeminiResponse | null;
  if (!res.ok || !json || json.error) {
    const msg = json?.error?.message ?? `Translate failed (${res.status})`;
    throw new Error(msg);
  }

  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof raw !== "string") {
    throw new Error("Translate: missing response text");
  }
  const arr = JSON.parse(raw) as Array<{ id: string; translation: string }>;
  return Object.fromEntries(arr.map((x) => [x.id, x.translation]));
}

// Dispatch-shaped credentials for translateBatch — mirrors what the surfaces'
// resolveDispatch returns, so callers pass it straight through.
export interface TranslateDispatch {
  provider: "google" | "openai" | "openai-compatible";
  apiKey: string;
  baseUrl?: string;
  wireModel: string;
}

// One entry point, best mechanism per provider: Google keeps the strict
// responseSchema path above (byte-identical behavior); everything else rides
// generateJsonChat — the same validated chat + corrective-retry mechanism
// every structured-output consumer uses. Callers never branch on mechanism;
// the id round-trip contract is identical on every path, and missing ids
// degrade to the original text on the caller's side.
export async function translateBatch(
  items: TranslateItem[],
  dispatch: TranslateDispatch,
): Promise<Record<string, string>> {
  if (items.length === 0) return {};
  if (dispatch.provider === "google") {
    return translateBatchToEnglish(items, dispatch.apiKey, dispatch.wireModel);
  }
  const arr = await generateJsonChat<Array<{ id: string; translation: string }>>(
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

// Shared shape for both mechanisms (the Gemini path embeds the same schema
// in its generationConfig above).
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
