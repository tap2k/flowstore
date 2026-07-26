import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the chat dispatcher; the Google structured path is exercised
// separately (it goes straight to the Gemini REST API, not through chat).
vi.mock("@flowstore/core/llm/dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flowstore/core/llm/dispatch")>();
  return { ...actual, chat: vi.fn() };
});

import { chat } from "@flowstore/core/llm/dispatch";
import { extractLooseJson, translateBatch } from "@flowstore/core/runtime/translate";

const mockChat = vi.mocked(chat);

beforeEach(() => mockChat.mockReset());

describe("extractLooseJson", () => {
  it("parses a bare JSON array or object", () => {
    expect(extractLooseJson('[{"id":"1"}]')).toEqual([{ id: "1" }]);
    expect(extractLooseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("recovers JSON wrapped in prose or code fences", () => {
    expect(extractLooseJson('Sure! Here you go:\n```json\n[{"id":"1","translation":"hi"}]\n```')).toEqual([
      { id: "1", translation: "hi" },
    ]);
  });

  it("returns null for unparseable text", () => {
    expect(extractLooseJson("no json here")).toBeNull();
    expect(extractLooseJson("broken [1, 2")).toBeNull();
  });
});

describe("translateBatch — chat fallback path", () => {
  const dispatch = {
    provider: "openai-compatible" as const,
    apiKey: "k",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    wireModel: "google/gemini-2.5-flash",
  };

  it("round-trips ids through a plain chat reply, tolerating fences", async () => {
    mockChat.mockResolvedValue({
      text: '```json\n[{"id":"10","translation":"Hello"},{"id":"20","translation":"How are you?"}]\n```',
      toolCalls: [],
      stopReason: "end_turn",
    });
    const out = await translateBatch(
      [
        { id: "10", text: "नमस्ते" },
        { id: "20", text: "कैसे हो?" },
      ],
      dispatch,
    );
    expect(out).toEqual({ "10": "Hello", "20": "How are you?" });
    // The dispatch params pass straight through to chat.
    expect(mockChat).toHaveBeenCalledWith(
      "openai-compatible",
      "k",
      "google/gemini-2.5-flash",
      expect.objectContaining({ tools: [] }),
      { baseUrl: dispatch.baseUrl },
    );
  });

  it("drops malformed entries instead of failing the batch", async () => {
    mockChat.mockResolvedValue({
      text: '[{"id":"1","translation":"ok"},{"id":2,"translation":"bad id"},{"id":"3"}]',
      toolCalls: [],
      stopReason: "end_turn",
    });
    const out = await translateBatch([{ id: "1", text: "x" }], dispatch);
    expect(out).toEqual({ "1": "ok" });
  });

  it("throws a retryable error when the reply has no JSON", async () => {
    mockChat.mockResolvedValue({ text: "sorry, I can't", toolCalls: [], stopReason: "end_turn" });
    await expect(translateBatch([{ id: "1", text: "x" }], dispatch)).rejects.toThrow(/parseable JSON/);
  });

  it("returns {} for an empty batch without dispatching", async () => {
    expect(await translateBatch([], dispatch)).toEqual({});
    expect(mockChat).not.toHaveBeenCalled();
  });
});
