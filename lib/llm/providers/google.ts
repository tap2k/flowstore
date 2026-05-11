import { genId } from "../../ids";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  StopReason,
  ToolCall,
} from "../types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type ThinkingConfig =
  | { thinkingBudget: number }
  | { thinkingLevel: "LOW" | "MEDIUM" | "HIGH" };

type GeminiRequestBody = {
  systemInstruction?: { parts: { text: string }[] };
  contents: GeminiContent[];
  tools?: {
    functionDeclarations: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>;
  }[];
  toolConfig?: { functionCallingConfig: { mode: "AUTO" | "ANY" | "NONE" } };
  generationConfig?: {
    maxOutputTokens?: number;
    thinkingConfig?: ThinkingConfig;
  };
};

// Defaults chosen so Gemini doesn't burn the whole output budget on thinking
// and return a candidate with no `parts`. 2.5 Pro can't disable thinking
// (min 128); 3.x uses thinkingLevel instead of a numeric budget.
function generationConfigFor(model: string): GeminiRequestBody["generationConfig"] {
  const is3 = /(^|[^0-9])3(\.|-|$)/.test(model);
  const is25 = model.includes("2.5");
  if (!is3 && !is25) return undefined;

  const isPro = model.includes("pro");
  const cfg: NonNullable<GeminiRequestBody["generationConfig"]> = {
    maxOutputTokens: 65536,
  };
  // TODO: Set modest thinking budget to leave room for result
  if (is3) {
    cfg.thinkingConfig = { thinkingLevel: isPro ? "MEDIUM" : "LOW" };
  } else {
    cfg.thinkingConfig = { thinkingBudget: isPro ? 8192 : 1024 };
  }
  return cfg;
}

type GeminiResponseBody = {
  candidates?: Array<{
    content: GeminiContent;
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
};

export async function callGoogle(
  apiKey: string,
  model: string,
  req: ChatRequest,
): Promise<ChatResponse> {
  const body: GeminiRequestBody = {
    systemInstruction: req.systemPrompt
      ? { parts: [{ text: req.systemPrompt }] }
      : undefined,
    contents: serializeMessages(req.messages),
    tools:
      req.tools.length > 0
        ? [
            {
              functionDeclarations: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
            },
          ]
        : undefined,
    toolConfig:
      req.tools.length > 0
        ? { functionCallingConfig: { mode: "AUTO" } }
        : undefined,
    generationConfig: generationConfigFor(model),
  };

  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as GeminiResponseBody | null;

  if (!res.ok || !json || json.error) {
    const msg = json?.error?.message ?? `Gemini request failed (${res.status})`;
    throw new Error(msg);
  }

  const candidate = json.candidates?.[0];
  if (!candidate) throw new Error("Gemini returned no candidates");
  return parseCandidate(candidate, json.usageMetadata);
}

function serializeMessages(messages: ChatMessage[]): GeminiContent[] {
  // Gemini matches function responses to calls by name + ordering, not by id.
  // Track id → name so a normalized `tool` message can resolve back to a name.
  const toolCallNames = new Map<string, string>();
  const out: GeminiContent[] = [];

  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", parts: [{ text: m.content }] });
      continue;
    }
    if (m.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        toolCallNames.set(tc.id, tc.name);
        parts.push({
          functionCall: {
            name: tc.name,
            args: (tc.arguments as Record<string, unknown>) ?? {},
          },
        });
      }
      out.push({ role: "model", parts });
      continue;
    }
    const name = toolCallNames.get(m.toolCallId);
    if (!name) {
      throw new Error(`tool result for unknown call id: ${m.toolCallId}`);
    }
    const part: GeminiPart = {
      functionResponse: { name, response: parseToolResult(m.result) },
    };
    // Coalesce consecutive tool results into one user content so Gemini sees
    // one user turn per assistant turn rather than alternating-by-tool-call.
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.role === "user" &&
      prev.parts.every((p) => "functionResponse" in p)
    ) {
      prev.parts.push(part);
    } else {
      out.push({ role: "user", parts: [part] });
    }
  }
  return out;
}

function parseToolResult(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return { result: v };
  } catch {
    return { result: raw };
  }
}

function parseCandidate(
  candidate: NonNullable<GeminiResponseBody["candidates"]>[number],
  usage: GeminiResponseBody["usageMetadata"],
): ChatResponse {
  const parts = candidate.content?.parts;
  if (!parts || parts.length === 0) {
    const reason = candidate.finishReason ?? "no parts";
    const hint =
      reason === "MAX_TOKENS"
        ? " — model used its entire output budget on thinking; try a smaller thinking budget or a different model"
        : "";
    throw new Error(`Gemini returned empty content (finishReason: ${reason})${hint}`);
  }
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const part of parts) {
    if ("text" in part && part.text) {
      text += part.text;
    } else if ("functionCall" in part) {
      toolCalls.push({
        id: genId("tc"),
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      });
    }
  }

  const stopReason: StopReason =
    toolCalls.length > 0
      ? "tool_use"
      : candidate.finishReason === "MAX_TOKENS"
        ? "max_tokens"
        : candidate.finishReason === "STOP"
          ? "end_turn"
          : "other";

  return {
    text,
    toolCalls,
    stopReason,
    usage: usage
      ? {
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: usage.candidatesTokenCount ?? 0,
          cachedInputTokens: usage.cachedContentTokenCount,
        }
      : undefined,
  };
}
