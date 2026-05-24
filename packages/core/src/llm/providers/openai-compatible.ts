import { callOpenAI } from "./openai";
import type { ChatRequest, ChatResponse, ProviderOptions } from "../types";

// OpenAI-compatible providers (OpenRouter, DeepInfra, Grok-native, Together,
// Fireworks, vLLM, Ollama) all ship /v1/chat/completions over a configurable
// base_url. Same wire shape as OpenAI's native chat-completions API, so we
// share the adapter — the only required difference is the base URL.
//
// Behavior parity with native OpenAI is best-effort: some providers ignore
// `tool_choice`, others stringify tool arguments differently, others omit
// `usage.prompt_tokens_details`. Callers should treat the response shape
// as additive, not strict.
export async function callOpenAICompatible(
  apiKey: string,
  model: string,
  req: ChatRequest,
  opts: ProviderOptions = {},
): Promise<ChatResponse> {
  if (!opts.baseUrl) {
    throw new Error(
      "openai-compatible provider requires base_url (set on the model entry or its provider declaration)",
    );
  }
  return callOpenAI(apiKey, model, req, opts);
}
