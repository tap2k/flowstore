import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { resolvePositions, STEP_X, STEP_Y } from "./placement";

function node(id: string): Node {
  return { id, position: { x: 0, y: 0 }, data: {} };
}

function edge(source: string, target: string): Edge {
  return { id: `${source}__xp_${target}`, source, target };
}

function positionOf(nodes: Node[], id: string) {
  return nodes.find((n) => n.id === id)!.position;
}

describe("resolvePositions", () => {
  it("falls back to auto-layout when nothing is pinned", () => {
    const out = resolvePositions([node("a"), node("b")], [edge("a", "b")], {});
    // dagre lays LR: b lands strictly right of a.
    expect(positionOf(out, "b").x).toBeGreaterThan(positionOf(out, "a").x);
  });

  it("keeps pinned nodes exactly where they were saved", () => {
    const saved = { a: { x: 500, y: 700 } };
    const out = resolvePositions([node("a")], [], saved);
    expect(positionOf(out, "a")).toEqual({ x: 500, y: 700 });
  });

  it("anchors a new node one rank right of the pinned source pointing at it", () => {
    const saved = { a: { x: 100, y: 200 } };
    const out = resolvePositions([node("a"), node("new")], [edge("a", "new")], saved);
    expect(positionOf(out, "new")).toEqual({ x: 100 + STEP_X, y: 200 });
  });

  it("anchors a new node one rank left of the pinned target it points at", () => {
    const saved = { z: { x: 1000, y: 300 } };
    const out = resolvePositions([node("z"), node("new")], [edge("new", "z")], saved);
    expect(positionOf(out, "new")).toEqual({ x: 1000 - STEP_X, y: 300 });
  });

  it("steps down a row when the anchored spot is already occupied", () => {
    const saved = {
      a: { x: 0, y: 0 },
      b: { x: STEP_X, y: 0 }, // already sitting where `new` would anchor
    };
    const out = resolvePositions(
      [node("a"), node("b"), node("new")],
      [edge("a", "new")],
      saved,
    );
    expect(positionOf(out, "new")).toEqual({ x: STEP_X, y: STEP_Y });
  });

  it("resolves a chain of new nodes off one pinned anchor", () => {
    const saved = { a: { x: 0, y: 0 } };
    const out = resolvePositions(
      [node("a"), node("b"), node("c")],
      [edge("a", "b"), edge("b", "c")],
      saved,
    );
    expect(positionOf(out, "b")).toEqual({ x: STEP_X, y: 0 });
    expect(positionOf(out, "c")).toEqual({ x: 2 * STEP_X, y: 0 });
  });

  it("parks a disconnected new node under the pinned bounding box", () => {
    const saved = { a: { x: 100, y: 0 }, b: { x: 500, y: 400 } };
    const out = resolvePositions([node("a"), node("b"), node("loner")], [], saved);
    expect(positionOf(out, "loner")).toEqual({ x: 100, y: 400 + STEP_Y });
  });

  it("stacks multiple disconnected new nodes instead of overlapping them", () => {
    const saved = { a: { x: 0, y: 0 } };
    const out = resolvePositions([node("a"), node("l1"), node("l2")], [], saved);
    const p1 = positionOf(out, "l1");
    const p2 = positionOf(out, "l2");
    expect(p1).not.toEqual(p2);
    expect(p2.y).toBeGreaterThan(p1.y);
  });
});
