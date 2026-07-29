import { describe, expect, it } from "vitest";
import { RealtimeTurnCollector, usageFromRealtimeUsage } from "../src/realtimeCell";
import type { S2sTurn } from "../src/s2sCell";
import { estimateLiveCost, liveRatesFor } from "../src/liveRates";

describe("usageFromRealtimeUsage", () => {
  it("splits token details into text/audio/cached fields", () => {
    expect(
      usageFromRealtimeUsage({
        input_tokens: 500,
        output_tokens: 1300,
        input_token_details: { text_tokens: 400, audio_tokens: 100, cached_tokens: 64 },
        output_token_details: { text_tokens: 50, audio_tokens: 1250 },
      }),
    ).toEqual({
      inputTokens: 400,
      outputTokens: 50,
      cachedInputTokens: 64,
      audioInputTokens: 100,
      audioOutputTokens: 1250,
    });
  });

  it("falls back to flat counts when no breakdown", () => {
    expect(usageFromRealtimeUsage({ input_tokens: 10, output_tokens: 20 })).toEqual({
      inputTokens: 10,
      outputTokens: 20,
    });
  });
});

describe("RealtimeTurnCollector", () => {
  it("reduces GA-named events into a turn", () => {
    const turns: S2sTurn[] = [];
    const c = new RealtimeTurnCollector((t) => turns.push(t));
    c.feed({ type: "session.created" }, 0);
    expect(c.ready).toBe(true);

    c.markSent(1000);
    c.feed({ type: "response.output_audio.delta", delta: "AAAA" }, 1300);
    c.feed({ type: "response.output_audio_transcript.delta", delta: "Sure — " }, 1350);
    c.feed({ type: "response.output_audio_transcript.delta", delta: "done." }, 1400);
    c.feed(
      {
        type: "response.done",
        response: {
          usage: { output_token_details: { text_tokens: 10, audio_tokens: 200 } },
        },
      },
      2500,
    );

    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe("Sure — done.");
    expect(turns[0].latencyMs).toBe(300);
    expect(turns[0].wallMs).toBe(1500);
    expect(turns[0].audioChunks).toEqual(["AAAA"]);
    expect(turns[0].usage).toEqual({
      inputTokens: 0,
      outputTokens: 10,
      audioOutputTokens: 200,
    });
  });

  it("accepts beta-era event names too", () => {
    const turns: S2sTurn[] = [];
    const c = new RealtimeTurnCollector((t) => turns.push(t));
    c.markSent(0);
    c.feed({ type: "response.audio.delta", delta: "BBBB" }, 100);
    c.feed({ type: "response.audio_transcript.delta", delta: "hi" }, 150);
    c.feed({ type: "response.done", response: {} }, 200);
    expect(turns[0].text).toBe("hi");
    expect(turns[0].audioChunks).toEqual(["BBBB"]);
    expect(turns[0].latencyMs).toBe(100);
  });
});

describe("realtime rates", () => {
  it("matches realtime models, mini row before full", () => {
    expect(liveRatesFor("gpt-realtime")?.audioOutPerM).toBe(64);
    expect(liveRatesFor("gpt-realtime-mini")?.audioOutPerM).toBe(20);
    expect(liveRatesFor("gpt-4o-realtime-preview")?.audioOutPerM).toBe(64);
    expect(liveRatesFor("gpt-5.5")).toBeNull();
  });

  it("prices realtime usage", () => {
    const est = estimateLiveCost(
      { inputTokens: 0, outputTokens: 0, audioInputTokens: 1_000_000, audioOutputTokens: 0 },
      "gpt-realtime",
    );
    expect(est).toBeCloseTo(32);
  });
});
