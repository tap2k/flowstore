const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
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
  },
): Promise<T> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.userPrompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: opts.responseSchema,
    },
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
    const msg = json?.error?.message ?? `Gemini JSON request failed (${res.status})`;
    throw new Error(msg);
  }

  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof raw !== "string") {
    throw new Error("Gemini JSON: missing response text");
  }
  return JSON.parse(raw) as T;
}
