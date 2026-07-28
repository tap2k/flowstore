import Dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

// Mirrors the design system's node metrics (--node-w, --node-gap-*) — dagre
// needs them as numbers, so they can't be read from CSS. NODE_HEIGHT is the
// two-line case (32px header + 10px padding + 2×18px title + 10px padding),
// which keeps rows clear when a flow name wraps.
export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 88;

export function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 64 });

  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) g.setEdge(e.source, e.target);

  Dagre.layout(g);

  return nodes.map((n) => {
    const { x, y } = g.node(n.id);
    return { ...n, position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 } };
  });
}
