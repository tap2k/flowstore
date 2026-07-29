import { describe, expect, it, vi } from "vitest";
import { runMatrix } from "../src/runner";
import type { Scenario } from "../src/types";

// Live columns overlap their scenarios (bounded pool) — the socket paces
// audio at speech speed, so serial live cells would cost the sum of spoken
// durations. Stub the Live driver and prove cells actually overlap.
vi.mock("../src/liveCell", () => ({
  runLiveCell: vi.fn(
    async (args: { scenario: Scenario; onUpdate: (p: unknown) => void }) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      args.onUpdate({ status: "done", turns: [], totalMs: 20 });
    },
  ),
}));

let running = 0;
let peak = 0;

const scenario = (id: string): Scenario => ({
  id,
  scenarioId: id,
  name: id,
  language: "EN",
  turns: ["hi"],
});

describe("runMatrix live columns", () => {
  it("overlaps a live column's scenarios up to the pool bound", async () => {
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
});
