import { chat, DEFAULT_PROVIDER } from "@ux4/core/llm/dispatch";
import type { ChatMessage, ChatUsage } from "@ux4/core/llm/types";
import type { TranscriptTurn } from "@ux4/core/runtime/transcript";

// Generate the next user-side utterance by inverting roles: the persona LLM
// sees the agent's lines as user input and produces an assistant reply, which
// becomes the next user turn in the simulator.
export async function generatePersonaTurn(args: {
  personaPrompt: string;
  history: TranscriptTurn[];
  apiKey: string;
  model: string;
}): Promise<{ text: string; usage?: ChatUsage }> {
  const messages: ChatMessage[] = [];
  for (const t of args.history) {
    if (!t.text) continue;
    if (t.role === "agent") {
      messages.push({ role: "user", content: t.text });
    } else {
      messages.push({ role: "assistant", content: t.text });
    }
  }
  if (messages.length === 0 || messages[messages.length - 1].role === "assistant") {
    // Persona has nothing to react to yet (e.g. user opens the conversation).
    // Seed with a neutral instruction so the model emits an opener.
    messages.push({ role: "user", content: "[begin]" });
  }
  const res = await chat(DEFAULT_PROVIDER, args.apiKey, args.model, {
    systemPrompt: args.personaPrompt,
    messages,
    tools: [],
  });
  return { text: res.text, usage: res.usage };
}
