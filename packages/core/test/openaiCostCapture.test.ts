import { describe, it, expect, vi, afterEach } from "vitest";
import { callOpenAI } from "@flowstore/core/llm/providers/openai";
import type { ChatRequest } from "@flowstore/core/llm/types";

// OpenRouter reports per-call dollar cost, but only when the request opts in
// with `usage: {include: true}` — a field api.openai.com does not know. The
// contract under test: the opt-in is sent to openrouter.ai URLs ONLY, and a
// returned usage.cost lands on the response.

const req: ChatRequest = { systemPrompt: "SP", messages: [], tools: [] };

function stubFetch(usage: Record<string, unknown> = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 3, ...usage },
        }),
      };
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("callOpenAI — OpenRouter cost capture", () => {
  it("opts into usage accounting on openrouter.ai and parses usage.cost", async () => {
    const calls = stubFetch({ cost: 0.00042 });
    const res = await callOpenAI("k", "m", req, {
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    });
    expect(calls[0].body.usage).toEqual({ include: true });
    expect(res.usage?.cost).toBe(0.00042);
    expect(res.usage?.inputTokens).toBe(5);
    expect(res.usage?.outputTokens).toBe(3);
  });

  it("never sends the usage opt-in to api.openai.com (default endpoint)", async () => {
    const calls = stubFetch();
    const res = await callOpenAI("k", "m", req);
    expect(calls[0].url).toContain("api.openai.com");
    expect("usage" in calls[0].body).toBe(false);
    expect(res.usage?.cost).toBeUndefined();
  });

  it("never sends the usage opt-in to other openai-compatible hosts", async () => {
    const calls = stubFetch();
    await callOpenAI("k", "m", req, { baseUrl: "https://api.groq.com/openai/v1/chat/completions" });
    expect("usage" in calls[0].body).toBe(false);
  });

  it("parses cached tokens from prompt_tokens_details", async () => {
    stubFetch({ prompt_tokens_details: { cached_tokens: 4 } });
    const res = await callOpenAI("k", "m", req);
    expect(res.usage?.cachedInputTokens).toBe(4);
  });
});
