import { describe, expect, it } from "vitest";
import { pcm16ChunksToWav } from "./audioCache";

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

describe("pcm16ChunksToWav", () => {
  it("writes a valid RIFF header over concatenated chunks", () => {
    const wav = pcm16ChunksToWav([b64([1, 2, 3, 4]), b64([5, 6])]);
    const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const ascii = (off: number, len: number) =>
      String.fromCharCode(...wav.slice(off, off + len));
    expect(wav.length).toBe(44 + 6);
    expect(ascii(0, 4)).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(36 + 6);
    expect(ascii(8, 4)).toBe("WAVE");
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(24000); // Live output rate
    expect(v.getUint32(28, true)).toBe(48000); // byte rate
    expect(v.getUint16(34, true)).toBe(16); // bits/sample
    expect(v.getUint32(40, true)).toBe(6); // data length
    expect([...wav.slice(44)]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
