import { describe, it, expect, afterEach, vi } from "vitest";
import { callGoogle } from "@flowstore/core/llm/providers/google";
import type { ChatRequest } from "@flowstore/core/llm/types";

const REQ: ChatRequest = {
  systemPrompt: "be helpful",
  messages: [{ role: "user", content: "hi" }],
  tools: [],
};

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

const malformed = () =>
  jsonResponse({ candidates: [{ content: {}, finishReason: "MALFORMED_FUNCTION_CALL" }] });

const valid = () =>
  jsonResponse({
    candidates: [{ content: { role: "model", parts: [{ text: "hello" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 },
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("callGoogle MALFORMED_FUNCTION_CALL handling", () => {
  it("retries past a malformed function call and returns the eventual content", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(malformed())
      .mockResolvedValueOnce(malformed())
      .mockResolvedValueOnce(valid());
    vi.stubGlobal("fetch", fetchMock);

    const p = callGoogle("key", "gemini-2.5-flash", REQ);
    await vi.runAllTimersAsync();
    const res = await p;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.text).toBe("hello");
    expect(res.stopReason).toBe("end_turn");
  });

  it("throws a clear error when every attempt is malformed", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(malformed());
    vi.stubGlobal("fetch", fetchMock);

    const p = callGoogle("key", "gemini-2.5-flash", REQ);
    const assertion = expect(p).rejects.toThrow(/MALFORMED_FUNCTION_CALL.*attempts/);
    await vi.runAllTimersAsync();
    await assertion;
    // 1 initial + 3 retries
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry a non-malformed empty candidate (STOP → end_turn)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ candidates: [{ content: {}, finishReason: "STOP" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await callGoogle("key", "gemini-2.5-flash", REQ);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.stopReason).toBe("end_turn");
    expect(res.text).toBe("");
  });
});
