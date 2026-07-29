import { describe, expect, it } from "vitest";
import { runS2sCell, type S2sConnect, type S2sSession } from "../src/s2sCell";
import type { CellState, Scenario } from "../src/types";

// Scripted in-memory transport: drives the skeleton's waiter wiring without
// a socket. Each sendUserTurn completes a turn on a microtask unless the
// script says otherwise.

const scenario = (turns: string[]): Scenario => ({
  id: "s1",
  scenarioId: "s1",
  name: "s1",
  language: "EN",
  turns,
});

const dispatch = { provider: "google" as const, apiKey: "k", wireModel: "m", live: true };

function trackCell() {
  let cell: Partial<CellState> = {};
  return {
    onUpdate: (p: Partial<CellState>) => {
      cell = { ...cell, ...p };
    },
    get: () => cell,
  };
}

describe("runS2sCell", () => {
  it("runs the scenario and reports done", async () => {
    const { onUpdate, get } = trackCell();
    const connect: S2sConnect = async ({ acc, onReady }) => {
      queueMicrotask(onReady);
      return {
        sendUserTurn: (text) => {
          queueMicrotask(() => {
            acc.addText(`echo ${text}`, 10);
            acc.complete(20);
          });
        },
        close: () => {},
      };
    };
    await runS2sCell(
      { systemPrompt: "SP", scenario: scenario(["a", "b"]), dispatch, onUpdate },
      connect,
      "Test",
    );
    expect(get().status).toBe("done");
    expect(get().turns?.map((t) => t.text)).toEqual(["a", "echo a", "b", "echo b"]);
  });

  it("a fatal landing BETWEEN turns surfaces as the real error, not a hang", async () => {
    const { onUpdate, get } = trackCell();
    let session: S2sSession;
    const connect: S2sConnect = async ({ acc, onReady, onFatal }) => {
      queueMicrotask(onReady);
      let turn = 0;
      session = {
        sendUserTurn: () => {
          turn++;
          if (turn === 1) {
            queueMicrotask(() => {
              acc.addText("ok", 5);
              acc.complete(9);
              // Socket dies right AFTER the turn resolves — in the gap
              // where no waiter exists. The latch must carry it.
              queueMicrotask(() => onFatal(new Error("socket died")));
            });
          }
          // Turn 2 never answers — without the latch this would stall out
          // the 90s turn timeout instead of reporting the close.
        },
        close: () => {},
      };
      return session;
    };
    await runS2sCell(
      { systemPrompt: "SP", scenario: scenario(["a", "b"]), dispatch, onUpdate },
      connect,
      "Test",
    );
    expect(get().status).toBe("error");
    expect(get().error).toBe("socket died");
  });

  it("abort hangs up: session closed, cell idle (not error)", async () => {
    const { onUpdate, get } = trackCell();
    const ac = new AbortController();
    let closed = false;
    const connect: S2sConnect = async ({ acc, onReady }) => {
      queueMicrotask(onReady);
      let turn = 0;
      return {
        sendUserTurn: () => {
          turn++;
          if (turn === 1) {
            queueMicrotask(() => {
              acc.addText("first", 5);
              acc.complete(9);
            });
          } else {
            // Second turn: user hits stop while the model is "speaking".
            queueMicrotask(() => ac.abort());
          }
        },
        close: () => {
          closed = true;
        },
      };
    };
    await runS2sCell(
      {
        systemPrompt: "SP",
        scenario: scenario(["a", "b"]),
        dispatch,
        onUpdate,
        signal: ac.signal,
      },
      connect,
      "Test",
    );
    expect(get().status).toBe("idle");
    expect(get().error).toBeUndefined();
    expect(closed).toBe(true);
    // The completed first exchange is kept for display.
    expect(get().turns?.map((t) => t.text)).toEqual(["a", "first"]);
  });

  it("transport close() after done is not reported as an error", async () => {
    const { onUpdate, get } = trackCell();
    const connect: S2sConnect = async ({ acc, onReady, onFatal }) => {
      queueMicrotask(onReady);
      return {
        sendUserTurn: () => {
          queueMicrotask(() => acc.complete(1));
        },
        // A naive transport reports its own teardown; the closing latch
        // must swallow it.
        close: () => onFatal(new Error("closed")),
      };
    };
    await runS2sCell(
      { systemPrompt: "SP", scenario: scenario(["a"]), dispatch, onUpdate },
      connect,
      "Test",
    );
    expect(get().status).toBe("done");
  });
});
