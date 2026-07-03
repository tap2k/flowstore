// OpenAI structured-output call. Uses response_format.json_schema strict mode
// so the model is forced to emit JSON matching the schema. Translates the
// Gemini-flavored schema (UPPERCASE type names) the callers produce into the
// JSON Schema dialect OpenAI expects (lowercase, additionalProperties:false on
// every object, every property listed in required).

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

interface GenerateJsonOpts {
  systemPrompt?: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  thinkingBudget?: number; // accepted for interface parity; OpenAI has no equivalent
}

// Recursive walk: lowercase `type`, force additionalProperties:false on object
// schemas, and ensure required lists every property (strict mode requires it).
// Caller schemas already mark every property required so the required-list
// rewrite is usually a no-op.
function toJsonSchema(schema: unknown): unknown {
  if (schema === null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  const inObj = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inObj)) {
    if (k === "type" && typeof v === "string") {
      out[k] = v.toLowerCase();
    } else {
      out[k] = toJsonSchema(v);
    }
  }
  if (out.type === "object") {
    out.additionalProperties = false;
    if (out.properties && typeof out.properties === "object") {
      const props = out.properties as Record<string, unknown>;
      out.required = Object.keys(props);
    }
  }
  return out;
}

export async function generateJsonOpenAI<T = unknown>(
  apiKey: string,
  model: string,
  opts: GenerateJsonOpts,
): Promise<T> {
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt?.trim()) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: opts.userPrompt });

  const schema = toJsonSchema(opts.responseSchema) as Record<string, unknown>;

  const body: Record<string, unknown> = {
    model,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "structured_output",
        strict: true,
        schema,
      },
    },
  };
  if (opts.maxOutputTokens !== undefined) body.max_tokens = opts.maxOutputTokens;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as OpenAIResponse | null;
  if (!res.ok || !json || json.error) {
    const msg = json?.error?.message ?? `OpenAI JSON request failed (${res.status})`;
    throw new Error(msg);
  }
  const raw = json.choices?.[0]?.message?.content;
  if (typeof raw !== "string") {
    throw new Error("OpenAI JSON: missing response content");
  }
  return JSON.parse(raw) as T;
}
