import { chat } from "../llm/dispatch";

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

// Lenient JSON recovery for plain-chat structured replies: models wrap the
// payload in prose or code fences despite instructions. Finds the outermost
// JSON value between the first bracket and the last matching one. Shared by
// every chat-plus-parse caller (translate fallback, compare's suggest-values).
export function extractLooseJson(text: string): unknown {
  for (const [open, close] of [
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through to the next bracket pair (or null)
      }
    }
  }
  return null;
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
// responseSchema path above (byte-identical behavior); chat-capable providers
// (OpenRouter et al.) get plain chat + lenient parse. Callers never branch on
// mechanism — the id round-trip contract is the same on every path, and
// missing ids degrade to the original text on the caller's side.
export async function translateBatch(
  items: TranslateItem[],
  dispatch: TranslateDispatch,
): Promise<Record<string, string>> {
  if (items.length === 0) return {};
  if (dispatch.provider === "google") {
    return translateBatchToEnglish(items, dispatch.apiKey, dispatch.wireModel);
  }
  const res = await chat(
    dispatch.provider,
    dispatch.apiKey,
    dispatch.wireModel,
    {
      systemPrompt:
        'Translate the "text" field of each item to English. ' +
        'Reply with ONLY a JSON array with one object per input, each {"id", "translation"}, preserving each "id" exactly. ' +
        "No commentary, no code fences.",
      messages: [{ role: "user", content: JSON.stringify(items) }],
      tools: [],
    },
    { baseUrl: dispatch.baseUrl },
  );
  const parsed = extractLooseJson(res.text);
  if (!Array.isArray(parsed)) {
    throw new Error("Translate: the model's reply wasn't parseable JSON — try again.");
  }
  const out: Record<string, string> = {};
  for (const x of parsed) {
    if (x && typeof x === "object" && typeof x.id === "string" && typeof x.translation === "string") {
      out[x.id] = x.translation;
    }
  }
  return out;
}
