import { callGoogle } from "./providers/google";
import { callOpenAI } from "./providers/openai";
import { callOpenAICompatible } from "./providers/openai-compatible";
import type { ChatRequest, ChatResponse, ProviderId, ProviderOptions } from "./types";

// Kept as a soft fallback for surfaces that haven't yet plumbed `resolveEndpoint`
// in. New code should call `resolveEndpoint(modelId, entry)` from
// `@ux4/core/files/models` and pass the result through.
export const DEFAULT_PROVIDER: ProviderId = "google";

export async function chat(
  provider: ProviderId,
  apiKey: string,
  model: string,
  req: ChatRequest,
  opts: ProviderOptions = {},
): Promise<ChatResponse> {
  switch (provider) {
    case "google":
      return callGoogle(apiKey, model, req);
    case "openai":
      return callOpenAI(apiKey, model, req, opts);
    case "openai-compatible":
      return callOpenAICompatible(apiKey, model, req, opts);
  }
}
