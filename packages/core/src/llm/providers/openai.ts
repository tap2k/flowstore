import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ProviderOptions,
  StopReason,
  ToolCall,
} from "../types";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

type OpenAIRole = "system" | "user" | "assistant" | "tool";

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenAIRequestBody = {
  model: string;
  messages: OpenAIMessage[];
  tools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  tool_choice?: "auto" | "none" | "required";
  // OpenRouter extension: opt in to usage accounting (returns usage.cost in
  // dollars). Never sent to api.openai.com, which doesn't know the field.
  usage?: { include: boolean };
};

type OpenAIResponseBody = {
  choices?: Array<{
    message: {
      role: OpenAIRole;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    cost?: number;
  };
  error?: { message?: string; type?: string };
};

export async function callOpenAI(
  apiKey: string,
  model: string,
  req: ChatRequest,
  opts: ProviderOptions = {},
): Promise<ChatResponse> {
  const body: OpenAIRequestBody = {
    model,
    messages: serializeMessages(req.systemPrompt, req.messages),
    tools:
      req.tools.length > 0
        ? req.tools.map((t) => ({
            type: "function" as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          }))
        : undefined,
    tool_choice: req.tools.length > 0 ? "auto" : undefined,
  };

  const url = opts.baseUrl ?? DEFAULT_ENDPOINT;
  // OpenRouter reports per-call dollar cost, but only when asked.
  if (url.includes("openrouter.ai")) body.usage = { include: true };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as OpenAIResponseBody | null;

  if (!res.ok || !json || json.error) {
    const msg = json?.error?.message ?? `OpenAI request failed (${res.status})`;
    throw new Error(msg);
  }

  const choice = json.choices?.[0];
  if (!choice) throw new Error("OpenAI returned no choices");

  const text = choice.message.content ?? "";
  const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: parseArgs(tc.function.arguments),
  }));

  const stopReason: StopReason =
    toolCalls.length > 0
      ? "tool_use"
      : choice.finish_reason === "length"
        ? "max_tokens"
        : choice.finish_reason === "stop"
          ? "end_turn"
          : "other";

  return {
    text,
    toolCalls,
    stopReason,
    usage: json.usage
      ? {
          inputTokens: json.usage.prompt_tokens ?? 0,
          outputTokens: json.usage.completion_tokens ?? 0,
          cachedInputTokens: json.usage.prompt_tokens_details?.cached_tokens,
          ...(json.usage.cost !== undefined ? { cost: json.usage.cost } : {}),
        }
      : undefined,
  };
}

function serializeMessages(systemPrompt: string, messages: ChatMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (systemPrompt.trim()) {
    out.push({ role: "system", content: systemPrompt });
  }
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const calls = m.toolCalls ?? [];
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls:
          calls.length > 0
            ? calls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: {
                  name: tc.name,
                  arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
                },
              }))
            : undefined,
      });
      continue;
    }
    out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.result });
  }
  return out;
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}
