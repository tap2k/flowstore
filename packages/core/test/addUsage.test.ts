import { describe, it, expect } from "vitest";
import { addUsage } from "@flowstore/core/runtime/promptClient";

describe("addUsage", () => {
  it("returns the other side when one is undefined", () => {
    const u = { inputTokens: 5, outputTokens: 2 };
    expect(addUsage(undefined, u)).toBe(u);
    expect(addUsage(u, undefined)).toBe(u);
    expect(addUsage(undefined, undefined)).toBeUndefined();
  });

  it("sums token counts", () => {
    expect(addUsage({ inputTokens: 10, outputTokens: 4 }, { inputTokens: 7, outputTokens: 3 })).toEqual({
      inputTokens: 17,
      outputTokens: 7,
    });
  });

  it("sums cost when both sides report it", () => {
    const sum = addUsage(
      { inputTokens: 1, outputTokens: 1, cost: 0.01 },
      { inputTokens: 1, outputTokens: 1, cost: 0.02 },
    );
    expect(sum?.cost).toBeCloseTo(0.03);
  });

  it("treats a missing cost as 0 when the other side reports one", () => {
    const sum = addUsage(
      { inputTokens: 1, outputTokens: 1, cost: 0.01 },
      { inputTokens: 1, outputTokens: 1 },
    );
    expect(sum?.cost).toBeCloseTo(0.01);
  });

  it("omits cost entirely when neither side reports it", () => {
    const sum = addUsage({ inputTokens: 1, outputTokens: 1 }, { inputTokens: 1, outputTokens: 1 });
    expect(sum && "cost" in sum).toBe(false);
  });

  it("applies the same either-side rule to cached tokens", () => {
    const both = addUsage(
      { inputTokens: 1, outputTokens: 1, cachedInputTokens: 3 },
      { inputTokens: 1, outputTokens: 1, cachedInputTokens: 4 },
    );
    expect(both?.cachedInputTokens).toBe(7);
    const one = addUsage(
      { inputTokens: 1, outputTokens: 1, cachedInputTokens: 3 },
      { inputTokens: 1, outputTokens: 1 },
    );
    expect(one?.cachedInputTokens).toBe(3);
    const neither = addUsage({ inputTokens: 1, outputTokens: 1 }, { inputTokens: 1, outputTokens: 1 });
    expect(neither && "cachedInputTokens" in neither).toBe(false);
  });

  it("applies the same either-side rule to audio tokens (s2s turns)", () => {
    const sum = addUsage(
      { inputTokens: 1, outputTokens: 1, audioInputTokens: 100, audioOutputTokens: 400 },
      { inputTokens: 1, outputTokens: 1, audioOutputTokens: 600 },
    );
    expect(sum?.audioInputTokens).toBe(100);
    expect(sum?.audioOutputTokens).toBe(1000);
    const neither = addUsage({ inputTokens: 1, outputTokens: 1 }, { inputTokens: 1, outputTokens: 1 });
    expect(neither && "audioInputTokens" in neither).toBe(false);
  });
});
