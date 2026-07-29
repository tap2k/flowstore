import { describe, expect, it } from "vitest";
import { feedLiveEvent, usageFromLiveMetadata, type LiveServerEvent } from "../src/liveCell";
import { TurnAccumulator, type S2sTurn } from "../src/s2sCell";
import { estimateS2sCost, s2sRatesFor } from "../src/s2sRates";

describe("usageFromLiveMetadata", () => {
  it("splits modality details into text and audio fields", () => {
    const u = usageFromLiveMetadata({
      promptTokenCount: 130,
      responseTokenCount: 1250,
      promptTokensDetails: [{ modality: "TEXT", tokenCount: 130 }],
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

  it("maps cached content tokens", () => {
    const u = usageFromLiveMetadata({
      promptTokenCount: 10,
      responseTokenCount: 20,
      cachedContentTokenCount: 7,
    });
    expect(u.cachedInputTokens).toBe(7);
  });
});

describe("feedLiveEvent", () => {
  const audioChunk: LiveServerEvent = {
    serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA" } }] } },
  };
  const collect = () => {
    const turns: S2sTurn[] = [];
    const acc = new TurnAccumulator((t) => turns.push(t));
    return { turns, acc };
  };

  it("signals readiness on setupComplete", () => {
    const { acc } = collect();
    expect(feedLiveEvent(acc, { setupComplete: {} }, 0)).toBe(true);
    expect(feedLiveEvent(acc, audioChunk, 1)).toBe(false);
  });

  it("accumulates transcription across messages and flushes on turnComplete", () => {
    const { turns, acc } = collect();
    acc.markSent(1000);
    feedLiveEvent(acc, audioChunk, 1400);
    feedLiveEvent(acc, { serverContent: { outputTranscription: { text: "Namaste! " } } }, 1500);
    feedLiveEvent(acc, { serverContent: { outputTranscription: { text: "How can I help?" } } }, 1600);
    feedLiveEvent(
      acc,
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
    // The spoken audio rides along, chunked in stream order.
    expect(turns[0].audioChunks).toEqual(["AAAA"]);
  });

  it("audio chunks accumulate per turn and reset between turns", () => {
    const { turns, acc } = collect();
    feedLiveEvent(acc, audioChunk, 0);
    feedLiveEvent(acc, audioChunk, 1);
    feedLiveEvent(acc, { serverContent: { turnComplete: true } }, 2);
    feedLiveEvent(
      acc,
      { serverContent: { outputTranscription: { text: "silent?" }, turnComplete: true } },
      3,
    );
    expect(turns[0].audioChunks).toEqual(["AAAA", "AAAA"]);
    expect(turns[1].audioChunks).toBeUndefined();
  });
});

describe("s2s rates (gemini)", () => {
  it("matches live and native-audio wire models only", () => {
    expect(s2sRatesFor("gemini-3.1-flash-live-preview")).not.toBeNull();
    expect(s2sRatesFor("gemini-2.5-flash-native-audio-preview-09-2025")).not.toBeNull();
    expect(s2sRatesFor("gemini-2.5-flash")).toBeNull();
  });

  it("estimates dollars from mixed text/audio usage, and only for live usage", () => {
    const est = estimateS2sCost(
      { inputTokens: 1_000_000, outputTokens: 0, audioInputTokens: 0, audioOutputTokens: 1_000_000 },
      "gemini-3.1-flash-live-preview",
    );
    expect(est).toBeCloseTo(0.5 + 12.0);
    // No audio tokens → not a live run → no estimate (text columns keep the
    // measured-or-nothing discipline).
    expect(
      estimateS2sCost({ inputTokens: 100, outputTokens: 100 }, "gemini-3.1-flash-live-preview"),
    ).toBeNull();
    expect(estimateS2sCost(undefined, "gemini-3.1-flash-live-preview")).toBeNull();
  });
});
