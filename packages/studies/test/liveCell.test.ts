import { describe, expect, it } from "vitest";
import {
  LiveTurnCollector,
  usageFromLiveMetadata,
  type LiveServerEvent,
  type LiveTurnResult,
} from "../src/liveCell";
import { estimateLiveCost, liveRatesFor } from "../src/liveRates";

describe("usageFromLiveMetadata", () => {
  it("splits modality details into text and audio fields", () => {
    const u = usageFromLiveMetadata({
      promptTokenCount: 130,
      responseTokenCount: 1250,
      promptTokensDetails: [
        { modality: "TEXT", tokenCount: 130 },
      ],
      responseTokensDetails: [
        { modality: "TEXT", tokenCount: 50 },
        { modality: "AUDIO", tokenCount: 1200 },
      ],
    });
    expect(u).toEqual({
      inputTokens: 130,
      outputTokens: 50,
      audioOutputTokens: 1200,
    });
  });

  it("falls back to flat counts when no modality breakdown", () => {
    const u = usageFromLiveMetadata({ promptTokenCount: 10, responseTokenCount: 20 });
    expect(u).toEqual({ inputTokens: 10, outputTokens: 20 });
  });
});

describe("LiveTurnCollector", () => {
  const audioChunk: LiveServerEvent = {
    serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA" } }] } },
  };

  it("accumulates transcription across messages and flushes on turnComplete", () => {
    const turns: LiveTurnResult[] = [];
    const c = new LiveTurnCollector((t) => turns.push(t));
    c.feed({ setupComplete: {} }, 0);
    expect(c.ready).toBe(true);

    c.markSent(1000);
    c.feed(audioChunk, 1400);
    c.feed({ serverContent: { outputTranscription: { text: "Namaste! " } } }, 1500);
    c.feed({ serverContent: { outputTranscription: { text: "How can I help?" } } }, 1600);
    c.feed(
      {
        usageMetadata: {
          promptTokenCount: 20,
          responseTokensDetails: [{ modality: "AUDIO", tokenCount: 300 }],
        },
        serverContent: { turnComplete: true },
      },
      1700,
    );

    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe("Namaste! How can I help?");
    // Latency is send→first evidence (the audio chunk at 1400), not the
    // transcription that trails it.
    expect(turns[0].latencyMs).toBe(400);
    // Wall time runs to turnComplete — audio streams long past first chunk,
    // and the cell total must carry that truth.
    expect(turns[0].wallMs).toBe(700);
    expect(turns[0].usage).toEqual({
      inputTokens: 20,
      outputTokens: 0,
      audioOutputTokens: 300,
    });
  });

  it("resets state between turns", () => {
    const turns: LiveTurnResult[] = [];
    const c = new LiveTurnCollector((t) => turns.push(t));
    c.markSent(0);
    c.feed({ serverContent: { outputTranscription: { text: "one" }, turnComplete: true } }, 50);
    c.markSent(100);
    c.feed({ serverContent: { outputTranscription: { text: "two" }, turnComplete: true } }, 180);
    expect(turns.map((t) => t.text)).toEqual(["one", "two"]);
    expect(turns[1].latencyMs).toBe(80);
    expect(turns[1].usage).toBeUndefined();
  });
});

describe("liveRates", () => {
  it("matches live and native-audio wire models only", () => {
    expect(liveRatesFor("gemini-3.1-flash-live-preview")).not.toBeNull();
    expect(liveRatesFor("gemini-2.5-flash-native-audio-preview-09-2025")).not.toBeNull();
    expect(liveRatesFor("gemini-2.5-flash")).toBeNull();
  });

  it("estimates dollars from mixed text/audio usage, and only for live usage", () => {
    const est = estimateLiveCost(
      { inputTokens: 1_000_000, outputTokens: 0, audioInputTokens: 0, audioOutputTokens: 1_000_000 },
      "gemini-3.1-flash-live-preview",
    );
    expect(est).toBeCloseTo(0.5 + 12.0);
    // No audio tokens → not a live run → no estimate (text columns keep the
    // measured-or-nothing discipline).
    expect(
      estimateLiveCost({ inputTokens: 100, outputTokens: 100 }, "gemini-3.1-flash-live-preview"),
    ).toBeNull();
    expect(estimateLiveCost(undefined, "gemini-3.1-flash-live-preview")).toBeNull();
  });
});
