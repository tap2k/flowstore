import { chat, DEFAULT_PROVIDER } from "@uxflows/core/llm/dispatch";
import type { ChatMessage, ChatUsage, ProviderId } from "@uxflows/core/llm/types";
import type { TranscriptTurn } from "@uxflows/core/runtime/transcript";

export interface PromptTurnResponse {
  text: string;
  usage?: ChatUsage;
}

export async function sendPromptTurn(args: {
  systemPrompt: string;
  history: TranscriptTurn[];
  userText: string;
  apiKey: string;
  model: string;
  provider?: ProviderId;
  baseUrl?: string;
}): Promise<PromptTurnResponse> {
  const messages: ChatMessage[] = args.history.map(toChatMessage);
  messages.push({ role: "user", content: args.userText });
  const res = await chat(
    args.provider ?? DEFAULT_PROVIDER,
    args.apiKey,
    args.model,
    {
      systemPrompt: args.systemPrompt,
      messages,
      tools: [],
    },
    { baseUrl: args.baseUrl },
  );
  return { text: res.text, usage: res.usage };
}

function toChatMessage(t: TranscriptTurn): ChatMessage {
  return t.role === "user"
    ? { role: "user", content: t.text }
    : { role: "assistant", content: t.text };
}
