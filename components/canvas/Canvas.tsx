import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { Spec } from "@/lib/schema/v0";
import { isFlowGoto } from "@/lib/schema/v0";
import { FlowNode, type FlowNodeData } from "./FlowNode";
import { isCalcRouteJunction } from "@/lib/schema/flowJunction";
import { autoLayout } from "./layout";
import { loadPositions, savePositions, type Positions } from "./positions";
import { useSpecStore } from "@/lib/store/spec";
import { useSimulateStore } from "@/lib/store/simulate";
import { validateGraph, groupIssuesByFlow, groupIssuesByEdge } from "@/lib/validation/graphRules";

const ACTIVE_EDGE_STROKE = "#0ea5e9";

function withActive(edge: Edge): Edge {
  return {
    ...edge,
    style: { ...edge.style, stroke: ACTIVE_EDGE_STROKE, strokeWidth: 2.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: ACTIVE_EDGE_STROKE, width: 18, height: 18 },
    animated: true,
  };
}

const nodeTypes = { flow: FlowNode };

function RelayoutIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

const SAVE_DEBOUNCE_MS = 300;

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// Edge color follows the destination flow's type. Matches the FlowNode
// border palette so an edge visually inherits the node it points at.
const EDGE_STROKE_BY_TYPE: Record<string, string> = {
  happy:     "#34d399", // emerald-400
  sad:       "#fbbf24", // amber-400
  off:       "#a1a1aa", // zinc-400
  utility:   "#38bdf8", // sky-400
  interrupt: "#a78bfa", // violet-400
};

function buildGraph(spec: Spec): { nodes: Node[]; edges: Edge[] } {
  const flowIds = new Set(spec.flows.map((f) => f.id));
  const flowsById = new Map(spec.flows.map((f) => [f.id, f]));
  const entryId = spec.agent.entry_flow_id;
  const issues = validateGraph(spec);
  const issuesByFlow = groupIssuesByFlow(issues);
  const issuesByEdge = groupIssuesByEdge(issues);

  const nodes: Node[] = spec.flows.map((f) => ({
    id: f.id,
    type: "flow",
    position: { x: 0, y: 0 },
    data: {
      name: f.name,
      flowType: f.type,
      isEntry: f.id === entryId,
      isJunction: isCalcRouteJunction(f),
      issues: issuesByFlow.get(f.id)?.map((i) => i.message),
    } satisfies FlowNodeData,
  }));

  const edges: Edge[] = [];
  for (const f of spec.flows) {
    for (const xp of f.exit_paths) {
      if (!isFlowGoto(xp.goto) || !flowIds.has(xp.goto)) continue;
      const edgeId = `${f.id}__${xp.id}`;
      const edgeIssues = issuesByEdge.get(edgeId);
      const targetType = flowsById.get(xp.goto)?.type;
      const stroke = edgeIssues
        ? "#ef4444"
        : EDGE_STROKE_BY_TYPE[targetType ?? ""] ?? "#a1a1aa";
      const label = xp.condition?.expression
        ? truncate(xp.condition.expression, 32)
        : undefined;
      edges.push({
        id: edgeId,
        source: f.id,
        target: xp.goto,
        label,
        labelStyle: { fontSize: 11, fill: "#52525b" },
        labelBgStyle: { fill: "#fafafa" },
        style: { stroke, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 18, height: 18 },
      });
    }
  }

  return { nodes, edges };
}

function applySavedPositions(nodes: Node[], edges: Edge[], saved: Positions): Node[] {
  const laidOut = autoLayout(nodes, edges);
  return laidOut.map((n) =>
    saved[n.id] ? { ...n, position: saved[n.id] } : n
  );
}

export function Canvas() {
  const spec = useSpecStore((s) => s.spec);
  if (!spec) return <EmptyCanvas />;
  return <CanvasInner spec={spec} />;
}

function EmptyCanvas() {
  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={[]}
        edges={[]}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background gap={20} size={1} color="#e4e4e7" />
      </ReactFlow>
    </div>
  );
}

function CanvasInner({ spec }: { spec: Spec }) {
  const specId = spec.agent.id;

  const initial = useMemo(() => {
    const g = buildGraph(spec);
    const saved = loadPositions(specId);
    return { nodes: applySavedPositions(g.nodes, g.edges, saved), edges: g.edges };
  }, [spec, specId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const lastExitEdgeId = useSimulateStore((s) => s.lastExitEdgeId);
  const skipSaveRef = useRef(false);

  const relayout = useCallback(() => {
    skipSaveRef.current = true;
    savePositions(specId, {});
    setNodes((current) => autoLayout(current, edges));
  }, [edges, setNodes, specId]);

  useEffect(() => {
    setNodes(initial.nodes);
  }, [initial, setNodes]);

  useEffect(() => {
    setEdges(
      initial.edges.map((e) => (e.id === lastExitEdgeId ? withActive(e) : e)),
    );
  }, [initial, lastExitEdgeId, setEdges]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const positions: Positions = Object.fromEntries(
        nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }])
      );
      savePositions(specId, positions);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, specId]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => useSpecStore.getState().setSelection({ kind: "flow", id: n.id })}
        onEdgeClick={(_, e) => {
          const [flowId, exitPathId] = e.id.split("__");
          if (flowId && exitPathId) {
            useSpecStore.getState().setSelection({ kind: "edge", flowId, exitPathId });
          }
        }}
        onPaneClick={() => useSpecStore.getState().setSelection(null)}
        onConnect={(c) => {
          if (c.source && c.target) {
            useSpecStore.getState().addExitPath(c.source, c.target, true);
          }
        }}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="#e4e4e7" />
        <Controls position="bottom-left" showInteractive={false}>
          <ControlButton onClick={relayout} title="Re-run auto layout">
            <RelayoutIcon />
          </ControlButton>
        </Controls>
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
