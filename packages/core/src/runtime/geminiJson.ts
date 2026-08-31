const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string; status?: string; details?: unknown[] };
}

// `thinkingBudget` is a 2.5-era control. Gemini 3 replaced it with
// `thinkingLevel` and REJECTS the old field outright — a bare
// "Request contains an invalid argument" 400, with no hint which argument.
// So the budget only ships to the generation it belongs to; on anything else
// the model's default thinking applies, which is the right behaviour anyway
// (the budget exists to stop 2.5 spending the output cap on thinking).
function acceptsThinkingBudget(model: string): boolean {
  return /2\.5/.test(model);
}

// Gemini structured-output call. Forces the model to emit JSON matching
// `responseSchema` — no fence-stripping or regex extraction needed. Schema
// uses Gemini's uppercased type names ("OBJECT", "STRING", ...).
export async function generateJson<T = unknown>(
  apiKey: string,
  model: string,
  opts: {
    systemPrompt?: string;
    userPrompt: string;
    responseSchema: Record<string, unknown>;
    maxOutputTokens?: number;
    thinkingBudget?: number;
  },
): Promise<T> {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseSchema: opts.responseSchema,
  };
  if (opts.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = opts.maxOutputTokens;
  if (opts.thinkingBudget !== undefined && acceptsThinkingBudget(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: opts.thinkingBudget };
  }
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.userPrompt }] }],
    generationConfig,
  };
  if (opts.systemPrompt?.trim()) {
    body.systemInstruction = { parts: [{ text: opts.systemPrompt }] };
  }

  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as GeminiResponse | null;
  if (!res.ok || !json || json.error) {
    const err = json?.error;
    // Gemini's 400s are often just "Request contains an invalid argument" with
    // the offending field buried in `details`. Carry it: a message that names
    // the field is the difference between a fix and a guessing round trip.
    const detail = err?.details?.length ? ` ${JSON.stringify(err.details)}` : "";
    const msg = err?.message
      ? `${err.message}${err.status ? ` (${err.status})` : ""}${detail}`
      : `Gemini JSON request failed (${res.status})`;
    throw new Error(msg);
  }

  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof raw !== "string") {
    throw new Error("Gemini JSON: missing response text");
  }
  return JSON.parse(raw) as T;
}
