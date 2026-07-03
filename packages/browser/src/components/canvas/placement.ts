import type { Edge, Node } from "@xyflow/react";
import { autoLayout, NODE_WIDTH, NODE_HEIGHT } from "./layout";
import type { Positions } from "./positions";

// One rank right / one row down, matching autoLayout's dagre spacing
// (ranksep 80 / nodesep 40) so anchored placement reads like the layout.
const STEP_X = NODE_WIDTH + 80;
const STEP_Y = NODE_HEIGHT + 40;

type XY = { x: number; y: number };

// Resolves every node's position given the saved (pinned) positions.
//
// Dagre coordinates are only meaningful when the WHOLE graph is dagre-laid-out.
// Once positions are pinned (and the canvas pins everything it renders via the
// debounced position save), a fresh dagre run bears no relation to where the
// pinned nodes actually sit — so a new node dropped at its dagre coordinate
// lands arbitrarily: on top of pinned nodes, or far off-viewport. Instead, a
// new node anchors to its first pinned/placed neighbor — one rank right of the
// source pointing at it, else one rank left of the target it points at —
// stepping down a row whenever the spot is occupied. New nodes with no placed
// neighbor park under the graph's bounding box, visibly "new and unfiled".
export function resolvePositions(nodes: Node[], edges: Edge[], saved: Positions): Node[] {
  const pinned = nodes.filter((n) => saved[n.id]);
  // Nothing pinned yet → pure auto-layout mode (fresh graph, or right after
  // a re-layout cleared the saved positions).
  if (pinned.length === 0) return autoLayout(nodes, edges);

  const pos = new Map<string, XY>(pinned.map((n) => [n.id, saved[n.id]]));

  // Cell-quantized occupancy: collisions step down one row until free.
  const cellKey = (p: XY) => `${Math.round(p.x / STEP_X)}:${Math.round(p.y / STEP_Y)}`;
  const taken = new Set([...pos.values()].map(cellKey));
  const placeAt = (id: string, want: XY): void => {
    const p = { ...want };
    while (taken.has(cellKey(p))) p.y += STEP_Y;
    taken.add(cellKey(p));
    pos.set(id, p);
  };

  // Multi-pass so a chain of new nodes (pinned → A → B, both new) resolves:
  // A anchors to the pinned source, then B anchors to the just-placed A.
  let pending = nodes.filter((n) => !saved[n.id]);
  while (pending.length > 0) {
    const unanchored: Node[] = [];
    for (const n of pending) {
      const inEdge = edges.find((e) => e.target === n.id && pos.has(e.source));
      const outEdge = edges.find((e) => e.source === n.id && pos.has(e.target));
      if (inEdge) {
        const a = pos.get(inEdge.source)!;
        placeAt(n.id, { x: a.x + STEP_X, y: a.y });
      } else if (outEdge) {
        const a = pos.get(outEdge.target)!;
        placeAt(n.id, { x: a.x - STEP_X, y: a.y });
      } else {
        unanchored.push(n);
      }
    }
    if (unanchored.length === pending.length) break; // no anchors left
    pending = unanchored;
  }

  if (pending.length > 0) {
    const placed = [...pos.values()];
    const minX = Math.min(...placed.map((p) => p.x));
    const maxY = Math.max(...placed.map((p) => p.y));
    for (const n of pending) placeAt(n.id, { x: minX, y: maxY + STEP_Y });
  }

  return nodes.map((n) => ({ ...n, position: pos.get(n.id)! }));
}
