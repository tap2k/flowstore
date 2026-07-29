import { describe, expect, it } from "vitest";
import { extractPcmChunks } from "./tts";

describe("extractPcmChunks", () => {
  it("collects inlineData parts in order", () => {
    expect(
      extractPcmChunks({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: "AAAA" } }, {}, { inlineData: { data: "BBBB" } }],
            },
          },
        ],
      }),
    ).toEqual(["AAAA", "BBBB"]);
  });

  it("returns empty on missing candidates", () => {
    expect(extractPcmChunks({})).toEqual([]);
  });
});
