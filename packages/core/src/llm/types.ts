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
};

export type ChatResponse = {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage?: ChatUsage;
};

export type ProviderId = "google";
