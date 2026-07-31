import { describe, expect, it, vi } from "vitest";
import { runMatrix } from "../src/runner";
import type { Scenario } from "../src/types";

// S2s columns overlap their scenarios (bounded pool) — the socket paces
// audio at speech speed, so serial s2s cells would cost the sum of spoken
// durations. Stub both drivers and prove overlap + provider routing.
vi.mock("../src/liveCell", () => ({
  runLiveCell: vi.fn(
    async (args: { scenario: Scenario; onUpdate: (p: unknown) => void }) => {
      calls.push("live");
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      args.onUpdate({ status: "done", turns: [], totalMs: 20 });
    },
  ),
}));
vi.mock("../src/realtimeCell", () => ({
  runRealtimeCell: vi.fn(
    async (args: { onUpdate: (p: unknown) => void }) => {
      calls.push("realtime");
      args.onUpdate({ status: "done", turns: [], totalMs: 1 });
    },
  ),
  runGrokVoiceCell: vi.fn(
    async (args: { onUpdate: (p: unknown) => void }) => {
      calls.push("grok");
      args.onUpdate({ status: "done", turns: [], totalMs: 1 });
    },
  ),
}));

let running = 0;
let peak = 0;
const calls: string[] = [];

const scenario = (id: string): Scenario => ({
  id,
  scenarioId: id,
  name: id,
  language: "EN",
  turns: ["hi"],
});

describe("runMatrix s2s columns", () => {
  it("overlaps an s2s column's scenarios up to the pool bound", async () => {
    const cells = await runMatrix({
      systemPrompt: "SP",
      scenarios: ["s1", "s2", "s3", "s4"].map(scenario),
      models: ["live-model"],
      resolveDispatch: () => ({
        provider: "google",
        apiKey: "k",
        wireModel: "gemini-x-live",
        live: true,
      }),
      onCell: () => {},
    });
    expect(Object.values(cells).every((c) => c.status === "done")).toBe(true);
    expect(peak).toBeGreaterThanOrEqual(2);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("columns filter runs only the requested column; others seed via resumeFrom", async () => {
    calls.length = 0;
    const done = { status: "done" as const, turns: [], totalMs: 5 };
    const cells = await runMatrix({
      systemPrompt: "SP",
      scenarios: [scenario("s1")],
      models: ["live-a", "live-b"],
      resolveDispatch: () => ({
        provider: "google",
        apiKey: "k",
        wireModel: "gemini-x-live",
        live: true,
      }),
      onCell: () => {},
      resumeFrom: { "s1::0": done },
      columns: [1],
    });
    // Only column 1 executed; column 0's standing cell seeded untouched.
    expect(calls).toEqual(["live"]);
    expect(cells["s1::0"]).toEqual(done);
    expect(cells["s1::1"].status).toBe("done");
  });

  it("off-script cells (composer probes) are excluded from divergence", async () => {
    const done = (texts: [string, string][]) => ({
      status: "done" as const,
      totalMs: 1,
      turns: texts.flatMap(([u, a]) => [
        { role: "user" as const, text: u, ts: 1, events: [] },
        { role: "agent" as const, text: a, ts: 2, events: [] },
      ]),
    });
    const cells = await runMatrix({
      systemPrompt: "SP",
      scenarios: [scenario("s1")], // script: ["hi"]
      models: ["live-a", "live-b"],
      resolveDispatch: () => ({ provider: "google", apiKey: "k", wireModel: "x", live: true }),
      onCell: () => {},
      // Incumbent on script; column 1 was probed (extra off-script turn) and
      // carries a stale divergent flag from before the probe.
      resumeFrom: {
        "s1::0": done([["hi", "totally different words entirely"]]),
        "s1::1": { ...done([["hi", "totally different words entirely"], ["probe", "reply"]]), divergent: true },
      },
      columns: [],
    });
    // Stale badge cleared, no fresh verdict minted for the off-script cell.
    expect(cells["s1::1"].divergent).toBeUndefined();
  });

  it("routes by provider: openai → realtime driver", async () => {
    calls.length = 0;
    const cells = await runMatrix({
      systemPrompt: "SP",
      scenarios: [scenario("s1")],
      models: ["gpt-realtime"],
      resolveDispatch: () => ({
        provider: "openai",
        apiKey: "k",
        wireModel: "gpt-realtime",
        live: true,
      }),
      onCell: () => {},
    });
    expect(calls).toEqual(["realtime"]);
    expect(cells["s1::0"].status).toBe("done");
  });

  it("routes by provider: xai → grok voice driver", async () => {
    calls.length = 0;
    const cells = await runMatrix({
      systemPrompt: "SP",
      scenarios: [scenario("s1")],
      models: ["grok-voice"],
      resolveDispatch: () => ({
        provider: "xai",
        apiKey: "k",
        wireModel: "grok-voice-latest",
        live: true,
      }),
      onCell: () => {},
    });
    expect(calls).toEqual(["grok"]);
    expect(cells["s1::0"].status).toBe("done");
  });

  it("a live dispatch with no driver errors crisply, not via some vendor SDK", async () => {
    const cells = await runMatrix({
      systemPrompt: "SP",
      scenarios: [scenario("s1")],
      models: ["mystery-voice"],
      resolveDispatch: () => ({
        provider: "openai-compatible",
        apiKey: "k",
        wireModel: "mystery-voice",
        live: true,
      }),
      onCell: () => {},
    });
    expect(cells["s1::0"].status).toBe("error");
    expect(cells["s1::0"].error).toMatch(/No speech-to-speech driver/);
  });
});
