import { describe, expect, it, vi } from "vitest";
vi.mock("@flowstore/studies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flowstore/studies")>();
  return { ...actual, runMatrix: vi.fn().mockResolvedValue({}) };
});
import { runMatrix } from "@flowstore/studies";
import { useCompareStore } from "./store";

const mockRun = vi.mocked(runMatrix);

describe("sendUserTurn wiring", () => {
  it("passes the cell's history as the probe script prefix, one column, resumable", async () => {
    const sc = { id: "s1", scenarioId: "s1", name: "S", language: "EN", turns: ["a", "b"] };
    useCompareStore.setState({
      scenarios: [sc],
      models: ["m0", "m1"],
      selected: "s1",
      runMode: null,
      cells: {
        "s1::1": {
          status: "done",
          totalMs: 0,
          turns: [
            { role: "user", text: "a", ts: 1, events: [] },
            { role: "agent", text: "ra", ts: 2, events: [] },
            { role: "user", text: "b", ts: 3, events: [] },
            { role: "agent", text: "rb", ts: 4, events: [] },
          ],
        },
      },
    });
    await useCompareStore.getState().sendUserTurn("NEW", 1);
    expect(mockRun).toHaveBeenCalledTimes(1);
    const args = mockRun.mock.calls[0][0];
    expect(args.scenarios[0].turns).toEqual(["a", "b", "NEW"]);
    expect(args.columns).toEqual([1]);
    // The standing transcript rides in as a resumable idle cell.
    expect(args.resumeFrom?.["s1::1"]?.status).toBe("idle");
    expect(args.resumeFrom?.["s1::1"]?.turns).toHaveLength(4);
    // The scenario script itself is untouched.
    expect(useCompareStore.getState().scenarios[0].turns).toEqual(["a", "b"]);
  });
});
