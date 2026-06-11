import { chat, DEFAULT_PROVIDER } from "@flowstore/core/llm/dispatch";
import type { ChatMessage, ChatUsage, ProviderId } from "@flowstore/core/llm/types";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import type { Modality } from "@flowstore/core/schema/v0";

// Default behavioral instructions for an LLM roleplaying the USER side of a
// simulated conversation. Applied at run time (see generatePersonaTurn), NOT
// baked into the persona, so the persona file stays declarative — pure identity
// + scenario — and these generic, medium-aware rules stay a runtime concern:
// flip the agent's modality and every persona re-tunes on the next turn, with
// no stored frame to go stale.
//
// Mode-INVARIANT rules plus a single length/format rule that varies by how the
// user is communicating (the only systematic axis today). This shapes what the
// persona GENERATES. Mechanical channel perturbation — ASR de-punctuation,
// fillers, barge-in truncation — is a separate transport layer that mutates the
// produced text deterministically; it deliberately does NOT live here (an LLM
// can't be reliably told to garble itself, and that layer must stay seeded for
// regression). See the harness-side asr_shape helpers.
export function defaultPersonaInstructions(modality: Modality): string {
  const lengthRule =
    modality === "text"
      ? "- You're texting: keep each message to a line or two — short and casual, never paragraphs or bullet points."
      : "- You're on a call: one short, spoken-sounding sentence per turn — no lists, no markdown, no spelling things out. Contractions and the odd filler are fine.";
  return [
    "How to play this part:",
    "- You are the user, not the agent. Only ever send the user's own messages — never write the agent's lines, answer your own questions, narrate, or emit tags or tool calls.",
    "- Stay in character. Never say you're an AI, a model, or a test; never break the fourth wall.",
    "- Reply in whatever language the agent is using.",
    lengthRule,
    '- If a message is empty or unclear, react as a real person would ("Hello?", "Sorry, what?").',
    "- Put [DONE] on its own line once the conversation has wrapped up — after any final thanks or goodbye — or if you give up.",
  ].join("\n");
}

// Generate the next user-side utterance by inverting roles: the persona LLM
// sees the agent's lines as user input and produces an assistant reply, which
// becomes the next user turn in the simulator. The persona prompt carries only
// identity + scenario; the medium-aware behavioral rail (role-lock, length,
// [DONE]) is composed on top here at run time — a runtime concern, owned by
// whoever drives the persona, not data stored in the spec.
export async function generatePersonaTurn(args: {
  personaPrompt: string;
  modality: Modality;
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
      systemPrompt: `${args.personaPrompt.trim()}\n\n${defaultPersonaInstructions(args.modality)}`,
      messages,
      tools: [],
    },
    { baseUrl: args.baseUrl },
  );
  return { text: res.text, usage: res.usage };
}
