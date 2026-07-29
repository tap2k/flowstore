import { chat, DEFAULT_PROVIDER } from "@flowstore/core/llm/dispatch";
import type {
  ChatMessage,
  ChatUsage,
  ProviderId,
  ToolCall,
  ToolDefinition,
} from "@flowstore/core/llm/types";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";

export interface CapabilityInvocation {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface PromptTurnResponse {
  text: string;
  usage?: ChatUsage;
  invocations: CapabilityInvocation[];
}

// Cap on tool round-trips per user turn, so a misbehaving model can't loop
// forever calling capabilities. Mirrors the Assistant's MAX_AGENT_LOOPS.
const MAX_TOOL_LOOPS = 6;

export async function sendPromptTurn(args: {
  systemPrompt: string;
  history: TranscriptTurn[];
  userText: string;
  apiKey: string;
  model: string;
  provider?: ProviderId;
  baseUrl?: string;
  // Capabilities exposed as tools. Empty/omitted ⇒ single-shot, identical to a
  // capability-free turn (the model gets no tools, so it never calls one).
  tools?: ToolDefinition[];
  // Resolves a tool call to a JSON-serializable result. May be async (e.g.
  // when the call hits a live capability endpoint instead of a static mock).
  resolveTool?: (call: ToolCall) => Promise<unknown> | unknown;
}): Promise<PromptTurnResponse> {
  const tools = args.tools ?? [];
  const messages: ChatMessage[] = args.history.map(toChatMessage);
  messages.push({ role: "user", content: args.userText });

  const invocations: CapabilityInvocation[] = [];
  let usage: ChatUsage | undefined;
  let text = "";

  for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
    const res = await chat(
      args.provider ?? DEFAULT_PROVIDER,
      args.apiKey,
      args.model,
      { systemPrompt: args.systemPrompt, messages, tools },
      { baseUrl: args.baseUrl },
    );
    usage = addUsage(usage, res.usage);
    text = res.text;

    if (res.toolCalls.length === 0) break;

    // Feed the assistant's tool calls and the resolved (mocked) results back in,
    // then let the model continue.
    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      const value = args.resolveTool ? await args.resolveTool(call) : {};
      const callArgs =
        call.arguments && typeof call.arguments === "object"
          ? (call.arguments as Record<string, unknown>)
          : {};
      invocations.push({ name: call.name, args: callArgs, result: value });
      messages.push({ role: "tool", toolCallId: call.id, result: JSON.stringify(value) });
    }
  }

  return { text, usage, invocations };
}

// Exported: the studies matrix runner accumulates usage across turns with the
// same semantics (cached and cost sum only when either side reports them).
export function addUsage(a: ChatUsage | undefined, b: ChatUsage | undefined): ChatUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const cached =
    a.cachedInputTokens !== undefined || b.cachedInputTokens !== undefined
      ? (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0)
      : undefined;
  const cost =
    a.cost !== undefined || b.cost !== undefined ? (a.cost ?? 0) + (b.cost ?? 0) : undefined;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
}

function toChatMessage(t: TranscriptTurn): ChatMessage {
  return t.role === "user"
    ? { role: "user", content: t.text }
    : { role: "assistant", content: t.text };
}
