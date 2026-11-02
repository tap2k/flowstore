import { describe, expect, it } from "vitest";
import { extractWav } from "./tts";

const RIFF = "UklGRgAAAAA="; // "RIFF" + 4 bytes

describe("extractWav", () => {
  it("passes a single WAV part through unchanged", () => {
    const wav = extractWav({
      candidates: [{ content: { parts: [{ inlineData: { data: RIFF, mimeType: "audio/wav" } }] } }],
    });
    expect(wav && String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(wav?.length).toBe(8);
  });

  it("wraps headerless PCM chunks in one WAV header", () => {
    const wav = extractWav({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: "AAAA" } }, {}, { inlineData: { data: "BBBB" } }],
          },
        },
      ],
    });
    expect(wav?.length).toBe(44 + 6);
  });

  it("returns null on missing candidates", () => {
    expect(extractWav({})).toBeNull();
  });
});
