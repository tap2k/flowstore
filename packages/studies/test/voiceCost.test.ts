import { describe, it, expect } from "vitest";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import { SPEECH_WPM, estimateVoiceCost } from "../src/voiceCost";

const turn = (role: "user" | "agent", text: string): TranscriptTurn => ({
  role,
  text,
  ts: 0,
  events: [],
});

// 30 user words, agent text with known words/chars.
const agentText = "word ".repeat(60).trim(); // 60 words, 299 chars
const turns = [
  turn("user", "word ".repeat(30).trim()),
  turn("agent", agentText),
];

describe("estimateVoiceCost", () => {
  it("returns null with no rates or no turns", () => {
    expect(estimateVoiceCost(turns, 0.01, {})).toBeNull();
    expect(estimateVoiceCost([], 0.01, { asrPerMin: 0.01 })).toBeNull();
  });

  it("prices ASR on caller minutes at the wpm model and TTS on measured agent chars", () => {
    const e = estimateVoiceCost(turns, 0.002, { asrPerMin: 0.03, ttsPerMChars: 10 })!;
    expect(e.asrCost).toBeCloseTo((30 / SPEECH_WPM) * 0.03); // 0.2 min caller speech
    expect(e.ttsCost).toBeCloseTo((agentText.length / 1_000_000) * 10);
    expect(e.llmCost).toBe(0.002);
    expect(e.total).toBeCloseTo(0.002 + e.asrCost! + e.ttsCost!);
    expect(e.speechMinutes).toBeCloseTo((30 + 60) / SPEECH_WPM);
    expect(e.perMinute).toBeCloseTo(e.total / e.speechMinutes);
  });

  it("a single rate produces a partial estimate; missing LLM cost counts as 0", () => {
    const e = estimateVoiceCost(turns, undefined, { ttsPerMChars: 10 })!;
    expect(e.asrCost).toBeUndefined();
    expect(e.llmCost).toBeUndefined();
    expect(e.total).toBeCloseTo(e.ttsCost!);
  });
});
