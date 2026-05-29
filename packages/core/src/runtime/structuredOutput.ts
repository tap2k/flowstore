import type { ProviderId } from "@flowstore/core/llm/types";
import { generateJson as generateJsonGemini } from "./geminiJson";
import { generateJsonOpenAI } from "./openaiJson";

// Provider-aware structured-output dispatch. Today: Google (Gemini
// responseSchema) and OpenAI (response_format.json_schema strict).
// Other providers (Anthropic JSON mode, OpenRouter bare-model) need
// retry/parse fallback shims — out of scope until a caller needs them.
//
// Callers construct the schema in the Gemini "UPPERCASE type names" flavor;
// the OpenAI path translates it. Keep new callers consistent with that shape
// so the dispatch stays drop-in.

export interface StructuredOutputOpts {
  systemPrompt?: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
}

export async function generateStructuredJson<T = unknown>(
  provider: ProviderId,
  apiKey: string,
  model: string,
  opts: StructuredOutputOpts,
): Promise<T> {
  if (provider === "google") {
    return generateJsonGemini<T>(apiKey, model, opts);
  }
  if (provider === "openai") {
    return generateJsonOpenAI<T>(apiKey, model, opts);
  }
  throw new Error(
    `Structured output not supported for provider "${provider}". Pick a Google or OpenAI model.`,
  );
}
