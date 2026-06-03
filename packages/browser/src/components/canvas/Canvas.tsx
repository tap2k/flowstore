import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  MarkerType,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { Spec } from "@flowstore/core/schema/v0";
import { isFlowGoto } from "@flowstore/core/schema/v0";
import { FlowNode, type FlowNodeData } from "./FlowNode";
import { ParallelEdge } from "./ParallelEdge";
import { isCalcRouteJunction } from "@flowstore/core/schema/flowJunction";
import { autoLayout } from "./layout";
import { loadPositions, savePositions, type Positions } from "./positions";
import { useSpecStore } from "@/lib/store/spec";
import { useSimulateStore } from "@/lib/store/simulate";
import { validateGraph, groupIssuesByFlow, groupIssuesByEdge } from "@flowstore/core/validation/graphRules";
import { worstSeverity } from "@/lib/diagnostics";

const ACTIVE_EDGE_STROKE = "#0ea5e9";

function withTraversed(edge: Edge, animated: boolean): Edge {
  return {
    ...edge,
    style: { ...edge.style, stroke: ACTIVE_EDGE_STROKE, strokeWidth: 2.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: ACTIVE_EDGE_STROKE, width: 18, height: 18 },
    animated,
  };
}

const nodeTypes = { flow: FlowNode };
const edgeTypes = { parallel: ParallelEdge };

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

// Brand wordmark, parked at the canvas bottom-left beside the zoom controls.
// Font matches the public site's logo (font-mono, semibold, tracking-tight).
function BrandMark() {
  return (
    <span className="select-none font-mono text-base font-semibold tracking-tight text-zinc-500">
      flowstore
    </span>
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
      issueLevel: worstSeverity(issuesByFlow.get(f.id) ?? []),
    } satisfies FlowNodeData,
  }));

  const edges: Edge[] = [];
  for (const f of spec.flows) {
    for (const xp of f.exit_paths) {
      if (!isFlowGoto(xp.goto) || !flowIds.has(xp.goto)) continue;
      const edgeId = `${f.id}__${xp.id}`;
      const edgeIssues = issuesByEdge.get(edgeId);
      const targetType = flowsById.get(xp.goto)?.type;
      const edgeLevel = worstSeverity(edgeIssues ?? []);
      const stroke =
        edgeLevel === "error"
          ? "#ef4444"
          : edgeLevel === "warning"
          ? "#f59e0b"
          : EDGE_STROKE_BY_TYPE[targetType ?? ""] ?? "#a1a1aa";
      const label = xp.condition?.expression
        ? truncate(xp.condition.expression, 32)
        : undefined;
      edges.push({
        id: edgeId,
        source: f.id,
        target: xp.goto,
        type: "parallel",
        label,
        labelStyle: { fontSize: 11, fill: "#52525b" },
        labelBgStyle: { fill: "#fafafa" },
        style: { stroke, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 18, height: 18 },
      });
    }
  }

  // Fan out edges that share a source→target pair, so multiple exits between the
  // same two flows don't render on the identical path (which hides all but one).
  const groups = new Map<string, Edge[]>();
  for (const e of edges) {
    const key = `${e.source}->${e.target}`;
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }
  for (const group of groups.values()) {
    group.forEach((e, i) => {
      e.data = { ...(e.data ?? {}), offsetIndex: i, offsetCount: group.length };
    });
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
        <Panel position="top-left">
          <NewFlowButton />
        </Panel>
        <Panel position="bottom-left">
          <BrandMark />
        </Panel>
      </ReactFlow>
    </div>
  );
}

// Imperatively brings the node named by spec.focusRequest into view.
// fitView centers AND adjusts zoom to a readable level (bounded by
// minZoom/maxZoom) — better than setCenter + getZoom for "show me this
// thing" intent. Only fires on nonce change so user clicks don't yank
// the viewport; depends on `nodes` so the effect re-runs after React
// Flow accepts a just-added node.
function FocusOnRequest({ nodes }: { nodes: Node[] }) {
  const focusRequest = useSpecStore((s) => s.focusRequest);
  const rf = useReactFlow();
  const lastNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.nonce === lastNonceRef.current) return;
    // Bail if the node hasn't reached React Flow's store yet; leave
    // the nonce un-recorded so the next nodes-dep retry can complete.
    if (!rf.getNode(focusRequest.id)) return;
    lastNonceRef.current = focusRequest.nonce;
    rf.fitView({
      nodes: [{ id: focusRequest.id }],
      duration: 300,
      minZoom: 0.6,
      maxZoom: 1.0,
      padding: 0.4,
    });
  }, [focusRequest, nodes, rf]);
  return null;
}

// Re-fits the viewport when a different spec is loaded into the same
// mounted canvas (opening another project, promoting local → GitHub, etc.).
// ReactFlow's `fitView` prop only fires on initial mount; without this the
// previous viewport (zoom + pan) sticks around even though the graph
// underneath is entirely different. Skips the very first mount — the mount
// fitView already handled it — and double-rAFs so React Flow has ingested
// the new nodes prop before we compute the fit.
function FitOnSpecChange({ specId }: { specId: string }) {
  const rf = useReactFlow();
  const lastSpecIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastSpecIdRef.current;
    lastSpecIdRef.current = specId;
    if (prev === null || prev === specId) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rf.fitView({ duration: 300, padding: 0.2, minZoom: 0.4, maxZoom: 1.0 });
      });
    });
  }, [specId, rf]);
  return null;
}

function NewFlowButton() {
  const addFlow = useSpecStore((s) => s.addFlow);
  return (
    <button
      type="button"
      onClick={() => addFlow(true)}
      title="Add a new flow"
      // Primary canvas action — sized and shaped distinctly from the
      // Run/Assistant pills in the top-right so it reads as "the entry
      // point," not a third pill in the same family. Always enabled:
      // addFlow scaffolds a blank agent automatically when no spec is
      // loaded, so the first click both creates the spec and adds the
      // first flow.
      className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-900 text-2xl font-light text-white shadow-lg ring-1 ring-black/5 transition hover:scale-105 hover:bg-zinc-700"
      aria-label="Add a new flow"
    >
      +
    </button>
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
  const traversedEdgeIds = useSimulateStore((s) => s.traversedEdgeIds);
  const simulateStatus = useSimulateStore((s) => s.status);
  // Store-side selection drives node.selected so programmatic selection
  // (addFlow, inspector close button, focus-on-comment-anchor, etc.)
  // shows the React Flow ring, not just the inspector. Click-driven
  // selection still flows through onNodeClick which sets store
  // selection, which loops back here.
  const selection = useSpecStore((s) => s.selection);
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
    const selectedFlowId = selection?.kind === "flow" ? selection.id : null;
    setNodes((current) => {
      let changed = false;
      const next = current.map((n) => {
        const wantSelected = n.id === selectedFlowId;
        if (n.selected === wantSelected) return n;
        changed = true;
        return { ...n, selected: wantSelected };
      });
      return changed ? next : current;
    });
  }, [selection, setNodes]);

  useEffect(() => {
    const traversed = new Set(traversedEdgeIds);
    const lastId = traversedEdgeIds[traversedEdgeIds.length - 1] ?? null;
    const isLive = simulateStatus === "ready" || simulateStatus === "thinking";
    setEdges(
      initial.edges.map((e) =>
        traversed.has(e.id) ? withTraversed(e, e.id === lastId && isLive) : e,
      ),
    );
  }, [initial, traversedEdgeIds, simulateStatus, setEdges]);

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
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="#e4e4e7" />
        <Panel position="top-left">
          <NewFlowButton />
        </Panel>
        <FocusOnRequest nodes={nodes} />
        <FitOnSpecChange specId={specId} />
        <Controls position="bottom-left" showInteractive={false}>
          <ControlButton onClick={relayout} title="Re-run auto layout">
            <RelayoutIcon />
          </ControlButton>
        </Controls>
        {/* Sits just right of the bottom-left controls, sharing their baseline.
            marginLeft clears the controls column (left:15 + ~26 wide). */}
        <Panel position="bottom-left" style={{ marginLeft: 52 }}>
          <BrandMark />
        </Panel>
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
