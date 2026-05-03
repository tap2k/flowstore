import { callGoogle } from "./providers/google";
import type { ChatRequest, ChatResponse, ProviderId } from "./types";

// Hardcoded for MVP. Selector lands when a second provider arrives.
export const DEFAULT_PROVIDER: ProviderId = "google";
export const DEFAULT_MODEL = "gemini-2.5-flash";

export const GOOGLE_MODELS: { id: string; label: string }[] = [
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

export async function chat(
  provider: ProviderId,
  apiKey: string,
  model: string,
  req: ChatRequest,
): Promise<ChatResponse> {
  switch (provider) {
    case "google":
      return callGoogle(apiKey, model, req);
  }
}
