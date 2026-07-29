import { describe, expect, it } from "vitest";
import { feedRealtimeEvent, usageFromRealtimeUsage } from "../src/realtimeCell";
import { TurnAccumulator, type S2sTurn } from "../src/s2sCell";
import { estimateS2sCost, s2sRatesFor } from "../src/s2sRates";

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

  it("derives text tokens from flat counts when details omit them", () => {
    // Details present but text_tokens missing: tokens must not be dropped.
    expect(
      usageFromRealtimeUsage({
        input_tokens: 500,
        output_tokens: 300,
        input_token_details: { audio_tokens: 100, cached_tokens: 50 },
        output_token_details: { audio_tokens: 250 },
      }),
    ).toEqual({
      inputTokens: 350,
      outputTokens: 50,
      cachedInputTokens: 50,
      audioInputTokens: 100,
      audioOutputTokens: 250,
    });
  });
});

describe("feedRealtimeEvent", () => {
  const collect = () => {
    const turns: S2sTurn[] = [];
    const acc = new TurnAccumulator((t) => turns.push(t));
    return { turns, acc };
  };

  it("signals readiness on session.updated (config acknowledged), not created", () => {
    const { acc } = collect();
    expect(feedRealtimeEvent(acc, { type: "session.created" }, 0)).toBe(false);
    expect(feedRealtimeEvent(acc, { type: "session.updated" }, 1)).toBe(true);
  });

  it("reduces GA-named events into a turn", () => {
    const { turns, acc } = collect();
    acc.markSent(1000);
    feedRealtimeEvent(acc, { type: "response.output_audio.delta", delta: "AAAA" }, 1300);
    feedRealtimeEvent(acc, { type: "response.output_audio_transcript.delta", delta: "Sure — " }, 1350);
    feedRealtimeEvent(acc, { type: "response.output_audio_transcript.delta", delta: "done." }, 1400);
    feedRealtimeEvent(
      acc,
      {
        type: "response.done",
        response: { usage: { output_token_details: { text_tokens: 10, audio_tokens: 200 } } },
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
    const { turns, acc } = collect();
    acc.markSent(0);
    feedRealtimeEvent(acc, { type: "response.audio.delta", delta: "BBBB" }, 100);
    feedRealtimeEvent(acc, { type: "response.audio_transcript.delta", delta: "hi" }, 150);
    feedRealtimeEvent(acc, { type: "response.done", response: {} }, 200);
    expect(turns[0].text).toBe("hi");
    expect(turns[0].audioChunks).toEqual(["BBBB"]);
    expect(turns[0].latencyMs).toBe(100);
  });
});

describe("s2s rates (realtime)", () => {
  it("matches realtime models, mini row before full", () => {
    expect(s2sRatesFor("gpt-realtime")?.audioOutPerM).toBe(64);
    expect(s2sRatesFor("gpt-realtime-mini")?.audioOutPerM).toBe(20);
    expect(s2sRatesFor("gpt-4o-realtime-preview")?.audioOutPerM).toBe(64);
    expect(s2sRatesFor("gpt-5.5")).toBeNull();
  });

  it("prices realtime usage", () => {
    const est = estimateS2sCost(
      { inputTokens: 0, outputTokens: 0, audioInputTokens: 1_000_000, audioOutputTokens: 0 },
      "gpt-realtime",
    );
    expect(est).toBeCloseTo(32);
  });
});
