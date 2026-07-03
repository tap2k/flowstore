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
  // Cap the response size. Important on Gemini 2.5, where THINKING tokens share
  // the output budget — a large prompt can spend it on thinking and truncate the
  // JSON (→ parse error). Give structured calls headroom.
  maxOutputTokens?: number;
  // Gemini 2.5 thinking budget. 0 disables thinking — right for a mechanical
  // classification (no reasoning needed) and it removes the truncation risk.
  // Ignored by providers without a thinking control.
  thinkingBudget?: number;
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
