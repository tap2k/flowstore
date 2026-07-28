import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";

// Mock only the wire call; addUsage (and everything else) stays real so the
// accumulation semantics under test are the production ones.
vi.mock("@flowstore/core/runtime/promptClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flowstore/core/runtime/promptClient")>();
  return { ...actual, sendPromptTurn: vi.fn() };
});

import { sendPromptTurn } from "@flowstore/core/runtime/promptClient";
import { DIVERGENCE_THRESHOLD, divergence, runCell, runMatrix } from "../src/runner";
import type { CellState, ModelDispatch, Scenario } from "../src/types";
import { IDLE_CELL, cellKey } from "../src/types";

const mockSend = vi.mocked(sendPromptTurn);

const turn = (role: "user" | "agent", text: string): TranscriptTurn => ({
  role,
  text,
  ts: 0,
  events: [],
});

const scenario = (id: string, turns: string[] = ["hi"]): Scenario => ({
  id,
  scenarioId: id,
  name: id,
  language: "EN",
  turns,
});

const dispatch = (model: string): ModelDispatch => ({
  provider: "openai",
  apiKey: "test-key",
  wireModel: model,
});

// Applies patches the way the page's reducer does, so assertions run against
// the state a consumer would actually see.
function collector() {
  const state = { cell: { ...IDLE_CELL } as CellState };
  return {
    state,
    onUpdate: (p: Partial<CellState>) => {
      state.cell = { ...state.cell, ...p };
    },
  };
}

beforeEach(() => {
  mockSend.mockReset();
});

describe("divergence", () => {
  it("identical transcripts score 0", () => {
    const a = [turn("agent", "Hello there, how can I help?")];
    expect(divergence(a, a)).toBe(0);
  });

  it("disjoint word sets score 1", () => {
    expect(
      divergence([turn("agent", "alpha beta gamma")], [turn("agent", "uno dos tres")]),
    ).toBe(1);
  });

  it("only agent turns count — user turns are ignored", () => {
    const a = [turn("user", "completely different question"), turn("agent", "same reply")];
    const b = [turn("user", "another thing entirely"), turn("agent", "same reply")];
    expect(divergence(a, b)).toBe(0);
  });

  it("two empty transcripts score 0, not NaN", () => {
    expect(divergence([], [])).toBe(0);
  });

  it("empty vs non-empty scores 1", () => {
    expect(divergence([], [turn("agent", "words here")])).toBe(1);
  });

  it("threshold is a real cut point between 0 and 1", () => {
    expect(DIVERGENCE_THRESHOLD).toBeGreaterThan(0);
    expect(DIVERGENCE_THRESHOLD).toBeLessThan(1);
  });
});

describe("runCell", () => {
  it("grows history turn by turn and accumulates usage incl. cost and cached", async () => {
    // history is passed by reference and read synchronously at call time —
    // snapshot its length per call, since the array keeps growing afterward.
    const historyLens: number[] = [];
    mockSend.mockImplementation(async ({ userText, history }) => {
      historyLens.push(history.length);
      return {
        text: `re:${userText}`,
        usage: { inputTokens: 10, outputTokens: 5, cost: 0.01, cachedInputTokens: 2 },
        invocations: [],
      };
    });
    const { state, onUpdate } = collector();
    await runCell({
      systemPrompt: "SP",
      scenario: scenario("s1", ["one", "two"]),
      dispatch: dispatch("m"),
      onUpdate,
    });

    expect(state.cell.status).toBe("done");
    expect(state.cell.turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "one"],
      ["agent", "re:one"],
      ["user", "two"],
      ["agent", "re:two"],
    ]);
    // First call starts empty; the second sees the first exchange as history.
    expect(historyLens).toEqual([0, 2]);
    expect(mockSend.mock.calls[1][0].systemPrompt).toBe("SP");
    // Usage sums across turns with cost/cached carried through.
    expect(state.cell.usage).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      cost: 0.02,
      cachedInputTokens: 4,
    });
    // Agent turns carry measured latency; totalMs is their sum.
    for (const t of state.cell.turns.filter((t) => t.role === "agent")) {
      expect(t.latencyMs).toBeTypeOf("number");
    }
  });

  it("leaves cost/cached absent when the provider never reports them", async () => {
    mockSend.mockResolvedValue({
      text: "ok",
      usage: { inputTokens: 3, outputTokens: 1 },
      invocations: [],
    });
    const { state, onUpdate } = collector();
    await runCell({
      systemPrompt: "SP",
      scenario: scenario("s1", ["a", "b"]),
      dispatch: dispatch("m"),
      onUpdate,
    });
    expect(state.cell.usage?.cost).toBeUndefined();
    expect(state.cell.usage?.cachedInputTokens).toBeUndefined();
    expect(state.cell.usage?.inputTokens).toBe(6);
  });

  it("a thrown dispatch lands as an error cell with the message", async () => {
    mockSend.mockRejectedValue(new Error("rate limited"));
    const { state, onUpdate } = collector();
    await runCell({
      systemPrompt: "SP",
      scenario: scenario("s1"),
      dispatch: dispatch("m"),
      onUpdate,
    });
    expect(state.cell.status).toBe("error");
    expect(state.cell.error).toBe("rate limited");
  });

  it("stop mid-turn drops the in-flight result, sends nothing further, reverts to idle", async () => {
    const ctrl = new AbortController();
    mockSend.mockImplementation(async () => {
      // Stop lands while the first turn is in flight.
      ctrl.abort();
      return { text: "late reply", usage: { inputTokens: 1, outputTokens: 1 }, invocations: [] };
    });
    const { state, onUpdate } = collector();
    await runCell({
      systemPrompt: "SP",
      scenario: scenario("s1", ["one", "two"]),
      dispatch: dispatch("m"),
      onUpdate,
      signal: ctrl.signal,
    });
    expect(mockSend).toHaveBeenCalledTimes(1); // "two" never sent
    expect(state.cell.status).toBe("idle");
    expect(state.cell.turns).toEqual([]); // late reply dropped, partial transcript gone
    expect(state.cell.usage).toBeUndefined();
  });

  it("resumeFrom keeps done cells and only runs the rest", async () => {
    mockSend.mockResolvedValue({ text: "fresh", usage: { inputTokens: 1, outputTokens: 1 }, invocations: [] });
    const doneCell: CellState = {
      status: "done",
      turns: [turn("user", "hi"), turn("agent", "kept reply")],
      totalMs: 5,
    };
    const scenarios = [scenario("s1"), scenario("s2")];
    const key1 = cellKey("s1", 0);
    const cells = await runMatrix({
      systemPrompt: "SP",
      scenarios,
      models: ["m"],
      resolveDispatch: () => dispatch("m"),
      onCell: () => {},
      resumeFrom: { [key1]: doneCell },
    });
    expect(mockSend).toHaveBeenCalledTimes(1); // only s2 ran
    expect(cells[key1].turns[1].text).toBe("kept reply"); // s1 untouched
    expect(cells[cellKey("s2", 0)].status).toBe("done");
  });
});

describe("runMatrix", () => {
  const replyFor = (model: string | undefined, text: string) =>
    mockSend.mockImplementation(async (args) => ({
      text: args.model === model ? text : "alpha beta gamma delta epsilon",
      usage: { inputTokens: 1, outputTokens: 1 },
      invocations: [],
    }));

  it("resolves dispatch per cell and marks keyless models as error cells", async () => {
    mockSend.mockResolvedValue({ text: "ok", invocations: [] });
    const resolve = vi.fn((model: string) => (model === "b" ? null : dispatch(model)));
    const scenarios = [scenario("s1"), scenario("s2")];
    const cells = await runMatrix({
      systemPrompt: "SP",
      scenarios,
      models: ["a", "b"],
      resolveDispatch: resolve,
      onCell: () => {},
    });

    // One resolution per cell (keys entered mid-run get picked up).
    expect(resolve).toHaveBeenCalledTimes(4);
    expect(cells[cellKey("s1", 0)].status).toBe("done");
    expect(cells[cellKey("s1", 1)].status).toBe("error");
    expect(cells[cellKey("s1", 1)].error).toMatch(/No API key for b/);
    expect(cells[cellKey("s2", 1)].status).toBe("error");
  });

  it("runs model columns in parallel", async () => {
    let active = 0;
    let maxActive = 0;
    mockSend.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 0));
      active--;
      return { text: "ok", invocations: [] };
    });
    await runMatrix({
      systemPrompt: "SP",
      scenarios: [scenario("s1")],
      models: ["a", "b", "c"],
      resolveDispatch: dispatch,
      onCell: () => {},
    });
    expect(maxActive).toBe(3);
  });

  it("flags divergent columns against column 0 and never flags the incumbent", async () => {
    replyFor("diff", "uno dos tres cuatro cinco");
    const cells = await runMatrix({
      systemPrompt: "SP",
      scenarios: [scenario("s1")],
      models: ["inc", "same", "diff"],
      resolveDispatch: dispatch,
      onCell: () => {},
    });
    expect(cells[cellKey("s1", 0)].divergent).toBeUndefined();
    expect(cells[cellKey("s1", 1)].divergent).toBe(false);
    expect(cells[cellKey("s1", 2)].divergent).toBe(true);
  });

  it("skips the divergence pass when the incumbent column failed", async () => {
    mockSend.mockImplementation(async (args) => {
      if (args.model === "inc") throw new Error("down");
      return { text: "ok", invocations: [] };
    });
    const cells = await runMatrix({
      systemPrompt: "SP",
      scenarios: [scenario("s1")],
      models: ["inc", "cand"],
      resolveDispatch: dispatch,
      onCell: () => {},
    });
    expect(cells[cellKey("s1", 0)].status).toBe("error");
    expect(cells[cellKey("s1", 1)].status).toBe("done");
    expect(cells[cellKey("s1", 1)].divergent).toBeUndefined();
  });
});
