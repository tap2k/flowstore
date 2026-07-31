export type JSONSchema = Record<string, unknown>;

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: JSONSchema;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: unknown;
  // Gemini 3.x attaches an opaque thoughtSignature to each functionCall part
  // and requires it echoed back verbatim in history, or it warns and degrades.
  // Carried here so the round-trip is faithful; ignored by other providers.
  thoughtSignature?: string;
};

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; result: string };

export type ChatRequest = {
  systemPrompt: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
};

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "other";

export type ChatUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  // Audio-modality tokens, reported by speech-to-speech models (Gemini Live).
  // Kept beside the text counts — inputTokens/outputTokens stay text-only —
  // so S2S and text columns stay comparable in one shape.
  audioInputTokens?: number;
  audioOutputTokens?: number;
  // Dollar cost of the call as reported by the provider. Only OpenRouter
  // returns this (and only when the request opts in via usage.include);
  // absent everywhere else — price locally from a rate table if needed.
  cost?: number;
};

export type ChatResponse = {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage?: ChatUsage;
};

// "xai" chats through the OpenAI-compatible adapter (api.x.ai is
// OpenAI-compatible); it exists as a distinct id so the s2s driver registry
// and the key slots can route Grok voice natively.
export type ProviderId = "google" | "openai" | "openai-compatible" | "xai";

// Per-provider runtime knobs the dispatcher passes through. base_url is
// load-bearing for openai-compatible (OpenRouter, DeepInfra, vLLM, etc.);
// the others ignore it.
export type ProviderOptions = {
  baseUrl?: string;
};
