import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@flowstore/studies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flowstore/studies")>();
  return { ...actual, runMatrix: vi.fn().mockResolvedValue({}) };
});
import { runMatrix } from "@flowstore/studies";
import { useCompareStore } from "./store";

const mockRun = vi.mocked(runMatrix);

const initialState = useCompareStore.getState();

describe("sendUserTurn wiring", () => {
  beforeEach(() => {
    useCompareStore.setState(initialState, true);
    mockRun.mockClear();
  });

  const u = (text: string) => ({ role: "user" as const, text });

  it("passes the cell's history as the probe script prefix, one column, resumable", async () => {
    const sc = { id: "s1", scenarioId: "s1", name: "S", language: "EN", turns: [u("a"), u("b")] };
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
    expect(args.scenarios[0].turns).toEqual([u("a"), u("b"), u("NEW")]);
    expect(args.columns).toEqual([1]);
    // The standing transcript rides in as a resumable idle cell.
    expect(args.resumeFrom?.["s1::1"]?.status).toBe("idle");
    expect(args.resumeFrom?.["s1::1"]?.turns).toHaveLength(4);
    // The scenario script itself is untouched.
    expect(useCompareStore.getState().scenarios[0].turns).toEqual([u("a"), u("b")]);
  });

  it("rejects (returns false, keeps state) when no scenario is selected or a run is live", async () => {
    useCompareStore.setState({ scenarios: [], selected: null, runMode: null });
    expect(await useCompareStore.getState().sendUserTurn("x", 0)).toBe(false);
    useCompareStore.setState({
      scenarios: [{ id: "s1", scenarioId: "s1", name: "S", language: "EN", turns: [u("a")] }],
      selected: "s1",
      runMode: { kind: "all" },
    });
    expect(await useCompareStore.getState().sendUserTurn("x", 0)).toBe(false);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("a cleanly-errored cell resumes instead of replaying", async () => {
    const sc = { id: "s1", scenarioId: "s1", name: "S", language: "EN", turns: [u("a")] };
    useCompareStore.setState({
      scenarios: [sc],
      models: ["m0"],
      selected: "s1",
      runMode: null,
      cells: {
        "s1::0": {
          status: "error",
          error: "boom",
          totalMs: 0,
          turns: [
            { role: "user", text: "a", ts: 1, events: [] },
            { role: "agent", text: "ra", ts: 2, events: [] },
          ],
        },
      },
    });
    expect(await useCompareStore.getState().sendUserTurn("NEW", 0)).toBe(true);
    const args = mockRun.mock.calls[0][0];
    expect(args.resumeFrom?.["s1::0"]?.status).toBe("idle");
    expect(args.scenarios[0].turns).toEqual([u("a"), u("NEW")]);
  });
});
