import { chat, DEFAULT_PROVIDER } from "@flowstore/core/llm/dispatch";
import type { ChatMessage, ChatUsage, ProviderId } from "@flowstore/core/llm/types";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import type { Modality } from "@flowstore/core/schema/v0";
import { composePersonaPrompt } from "./personaPrompt";

// Appended to the (already-trimmed) agent line when the persona is barging in,
// so it knows it's cutting in having only half-heard — and asserts its own
// thing instead of smoothly answering a question it didn't actually hear. Keep
// in sync with the Python harness (_persona.py BARGE_CUE).
const BARGE_CUE =
  "\n\n(You cut in here, before the agent finished — you only caught the start of that line. Say what you want; don't wait for them.)";

// Generate the next user-side utterance by inverting roles: the persona LLM
// sees the agent's lines as user input and produces an assistant reply, which
// becomes the next user turn in the simulator. The persona prompt carries only
// identity + scenario; the medium-aware rail is composed on top via
// composePersonaPrompt at run time. Traits never enter the prompt — they're
// machine-read knobs (asr/barge_in) handled by the caller.
export async function generatePersonaTurn(args: {
  personaPrompt: string;
  modality: Modality;
  history: TranscriptTurn[];
  // The last agent line was barge-trimmed; cue the persona that it's cutting in.
  bargedIn?: boolean;
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
  } else if (args.bargedIn) {
    const last = messages[messages.length - 1];
    if (last?.role === "user") {
      messages[messages.length - 1] = { role: "user", content: last.content + BARGE_CUE };
    }
  }
  const res = await chat(
    args.provider ?? DEFAULT_PROVIDER,
    args.apiKey,
    args.model,
    {
      systemPrompt: composePersonaPrompt({
        personaPrompt: args.personaPrompt,
        modality: args.modality,
      }),
      messages,
      tools: [],
    },
    { baseUrl: args.baseUrl },
  );
  return { text: res.text, usage: res.usage };
}
