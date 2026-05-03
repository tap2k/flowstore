import { useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { Spec } from "@/lib/schema/v0";
import { FlowNode, type FlowNodeData } from "./FlowNode";
import { autoLayout } from "./layout";
import { loadPositions, savePositions, type Positions } from "./positions";
import { useSpecStore } from "@/lib/store/spec";
import { validateGraph, groupIssuesByFlow, groupIssuesByEdge } from "@/lib/validation/graphRules";

const nodeTypes = { flow: FlowNode };

const SAVE_DEBOUNCE_MS = 300;

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function buildGraph(spec: Spec): { nodes: Node[]; edges: Edge[] } {
  const flowIds = new Set(spec.flows.map((f) => f.id));
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
      issues: issuesByFlow.get(f.id)?.map((i) => i.message),
    } satisfies FlowNodeData,
  }));

  const edges: Edge[] = [];
  for (const f of spec.flows) {
    for (const xp of f.routing.exit_paths) {
      if (!xp.next_flow_id || !flowIds.has(xp.next_flow_id)) continue;
      const edgeId = `${f.id}__${xp.id}`;
      const edgeIssues = issuesByEdge.get(edgeId);
      const stroke = edgeIssues
        ? "#ef4444"
        : xp.type === "happy"
        ? "#34d399"
        : "#fbbf24";
      const label = xp.condition?.expression
        ? truncate(xp.condition.expression, 32)
        : undefined;
      edges.push({
        id: edgeId,
        source: f.id,
        target: xp.next_flow_id,
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

  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
  }, [initial, setNodes, setEdges]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
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
        <Controls position="bottom-right" />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
