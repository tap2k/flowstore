import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@flowstore/core/llm/dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flowstore/core/llm/dispatch")>();
  return { ...actual, chat: vi.fn() };
});

import { chat } from "@flowstore/core/llm/dispatch";
import { generateJsonChat } from "@flowstore/core/runtime/chatJson";
import { generateStructuredJson } from "@flowstore/core/runtime/structuredOutput";

const mockChat = vi.mocked(chat);
const reply = (text: string) => ({ text, toolCalls: [], stopReason: "end_turn" as const });

// The judges' schema flavor: Gemini UPPERCASE types, all-required semantics.
const SCHEMA = {
  type: "OBJECT",
  properties: {
    score: { type: "INTEGER" },
    notes: { type: "STRING" },
  },
  required: ["score", "notes"],
};

const OPTS = {
  systemPrompt: "You are a judge.",
  userPrompt: "Judge this.",
  responseSchema: SCHEMA,
  baseUrl: "https://openrouter.ai/api/v1/chat/completions",
};

beforeEach(() => mockChat.mockReset());

describe("generateJsonChat", () => {
  it("returns schema-valid JSON on the first attempt (fences tolerated)", async () => {
    mockChat.mockResolvedValue(reply('```json\n{"score": 4, "notes": "solid"}\n```'));
    const out = await generateJsonChat("openai-compatible", "k", "m", OPTS);
    expect(out).toEqual({ score: 4, notes: "solid" });
    expect(mockChat).toHaveBeenCalledTimes(1);
    // The schema rides the system prompt; baseUrl reaches the dispatcher.
    const [, , , req, provOpts] = mockChat.mock.calls[0];
    expect(req.systemPrompt).toContain('"additionalProperties":false');
    expect(provOpts).toEqual({ baseUrl: OPTS.baseUrl });
  });

  it("retries once with the validation errors fed back, then succeeds", async () => {
    mockChat
      .mockResolvedValueOnce(reply('{"score": "four", "notes": "wrong type"}'))
      .mockResolvedValueOnce(reply('{"score": 4, "notes": "fixed"}'));
    const out = await generateJsonChat("openai-compatible", "k", "m", OPTS);
    expect(out).toEqual({ score: 4, notes: "fixed" });
    expect(mockChat).toHaveBeenCalledTimes(2);
    // The corrective turn contains the failure and the prior reply is in history.
    const retryReq = mockChat.mock.calls[1][3];
    const lastMsg = retryReq.messages.at(-1)!;
    expect(lastMsg.role).toBe("user");
    expect((lastMsg as { content: string }).content).toMatch(/invalid/);
  });

  it("throws after a failed retry (missing required key)", async () => {
    mockChat.mockResolvedValue(reply('{"score": 4}'));
    await expect(generateJsonChat("openai-compatible", "k", "m", OPTS)).rejects.toThrow(
      /failed validation/,
    );
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  it("throws when replies never contain JSON", async () => {
    mockChat.mockResolvedValue(reply("I refuse to answer in JSON."));
    await expect(generateJsonChat("openai-compatible", "k", "m", OPTS)).rejects.toThrow(
      /not parseable/,
    );
  });
});

describe("generateStructuredJson routing", () => {
  it("dispatches openai-compatible through the validated chat path", async () => {
    mockChat.mockResolvedValue(reply('{"score": 5, "notes": "ok"}'));
    const out = await generateStructuredJson("openai-compatible", "k", "m", OPTS);
    expect(out).toEqual({ score: 5, notes: "ok" });
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});
