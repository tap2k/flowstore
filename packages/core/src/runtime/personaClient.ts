import { chat, DEFAULT_PROVIDER } from "@flowstore/core/llm/dispatch";
import type { ChatMessage, ChatUsage, ProviderId } from "@flowstore/core/llm/types";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";

// Generate the next user-side utterance by inverting roles: the persona LLM
// sees the agent's lines as user input and produces an assistant reply, which
// becomes the next user turn in the simulator. The persona prompt is used
// verbatim — its behavioral frame (role, channel, [DONE]) is baked in at
// generation time (see personaFrame), so what the author edits is what runs.
//
// By design, NO behavioral rail is applied here: a persona without the frame
// (hand-authored / legacy / cross-repo) runs as-is. The deferred "option B" —
// a thin always-on role-lock + empty-input rail — would live exactly here. See
// the DESIGN NOTE on personaFrame in personaGen.ts before adding one.
export async function generatePersonaTurn(args: {
  personaPrompt: string;
  history: TranscriptTurn[];
  apiKey: string;
  model: string;
  provider?: ProviderId;
  baseUrl?: string;
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
    // Seed with a natural instruction (not a bare token) so even small models
    // emit a clean opener instead of echoing the seed.
    messages.push({
      role: "user",
      content: "(You're starting the conversation. Send your first message as this user.)",
    });
  }
  const res = await chat(
    args.provider ?? DEFAULT_PROVIDER,
    args.apiKey,
    args.model,
    {
      systemPrompt: args.personaPrompt,
      messages,
      tools: [],
    },
    { baseUrl: args.baseUrl },
  );
  return { text: res.text, usage: res.usage };
}
