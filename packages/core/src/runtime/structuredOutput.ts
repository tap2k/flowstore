import type { ProviderId } from "@flowstore/core/llm/types";
import { generateJson as generateJsonGemini } from "./geminiJson";
import { generateJsonOpenAI } from "./openaiJson";
import { generateJsonChat } from "./chatJson";

// Provider-aware structured-output dispatch: best mechanism per provider.
// Google → Gemini responseSchema; OpenAI → response_format.json_schema
// strict; anything else chat-capable (OpenRouter / openai-compatible) →
// plain chat + lenient parse + ajv validation with one corrective retry
// (chatJson). Every route enforces the same translated schema, so callers
// never branch on mechanism.
//
// Callers construct the schema in the Gemini "UPPERCASE type names" flavor;
// the OpenAI and chat paths translate it. Keep new callers consistent with
// that shape so the dispatch stays drop-in.

export interface StructuredOutputOpts {
  systemPrompt?: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  // Cap the response size. Important on Gemini 2.5, where THINKING tokens share
  // the output budget — a large prompt can spend it on thinking and truncate the
  // JSON (→ parse error). Give structured calls headroom. Not honored on the
  // chat path (ChatRequest has no token cap — see chatJson).
  maxOutputTokens?: number;
  // Gemini 2.5 thinking budget. 0 disables thinking — right for a mechanical
  // classification (no reasoning needed) and it removes the truncation risk.
  // Ignored by providers without a thinking control.
  thinkingBudget?: number;
  // Endpoint for openai-compatible dispatch (OpenRouter et al.). Ignored by
  // the Google/OpenAI strict paths.
  baseUrl?: string;
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
  return generateJsonChat<T>(provider, apiKey, model, opts);
}
