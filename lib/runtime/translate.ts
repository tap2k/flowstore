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
