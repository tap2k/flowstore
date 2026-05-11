import { chat, DEFAULT_PROVIDER } from "@/lib/llm/dispatch";
import type { ChatMessage, ChatUsage } from "@/lib/llm/types";
import type { TranscriptTurn } from "@/lib/store/simulate";

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
}): Promise<PromptTurnResponse> {
  const messages: ChatMessage[] = args.history.map(toChatMessage);
  messages.push({ role: "user", content: args.userText });
  const res = await chat(DEFAULT_PROVIDER, args.apiKey, args.model, {
    systemPrompt: args.systemPrompt,
    messages,
    tools: [],
  });
  return { text: res.text, usage: res.usage };
}

function toChatMessage(t: TranscriptTurn): ChatMessage {
  return t.role === "user"
    ? { role: "user", content: t.text }
    : { role: "assistant", content: t.text };
}
