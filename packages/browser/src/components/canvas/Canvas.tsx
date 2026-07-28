import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { NodeActionBar } from "./NodeActionBar";
import { ParallelEdge } from "./ParallelEdge";
import { isCalcRouteJunction } from "@flowstore/core/schema/flowJunction";
import { autoLayout } from "./layout";
import { resolvePositions } from "./placement";
import { loadPositions, savePositions, type Positions } from "./positions";
import { useSpecStore } from "@/lib/store/spec";
import { useThemeStore } from "@/lib/store/theme";
import { useUiStore } from "@/lib/store/ui";
import { useSimulateStore } from "@/lib/store/simulate";
import { useAssistantChangesStore } from "@/lib/store/assistantChanges";
import { validateGraph, groupIssuesByFlow, groupIssuesByEdge, isImportedFlowless } from "@flowstore/core/validation/graphRules";
import { worstSeverity } from "@/lib/diagnostics";
import { loadProject } from "@flowstore/core/files";
import { loadPortableSpec } from "@/lib/store/loadSpec";
import { parseSourceToSpec } from "@/lib/chat/specParse";
import { resolveDispatch, useSettingsStore } from "@/lib/store/settings";
import { Button } from "@/components/ui";

// A traversed edge. `live` = the transition just taken this turn: thick, bright,
// glowing, animated so the eye lands on it. Prior traversed edges fade to a thin
// pale trail so history doesn't compete with the current step.
function withTraversed(edge: Edge, live: boolean, t: CanvasTokens): Edge {
  const stroke = live ? t.edgeActive : t.edgeTraversed;
  return {
    ...edge,
    style: live
      ? {
          ...edge.style,
          stroke,
          strokeWidth: 4,
          filter: `drop-shadow(0 0 6px ${t.edgeActiveGlow})`,
        }
      : { ...edge.style, stroke, strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: stroke,
      width: live ? 24 : 16,
      height: live ? 24 : 16,
    },
    animated: live,
  };
}

// An edge the ASSISTANT just added or re-routed (see assistantChanges.ts).
// Violet to match the node halo (the "AI did this" hue — deliberately not
// red-ish, which reads as an error); steady (no marching ants — `animated`
// is the sim's live-transition signature).
function withAssistantGlow(edge: Edge, t: CanvasTokens): Edge {
  return {
    ...edge,
    style: {
      ...edge.style,
      stroke: t.edgeAssistant,
      strokeWidth: 3,
      filter: `drop-shadow(0 0 5px ${t.edgeAssistantGlow})`,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: t.edgeAssistant,
      width: 20,
      height: 20,
    },
  };
}

// Matches the node selection ring (achromatic, --select-ring), so a selected
// edge reads the same as a selected node. ParallelEdge ignores React Flow's
// `selected` flag (it only renders the style we pass), so selection has to be
// styled here.
function withSelected(edge: Edge, t: CanvasTokens): Edge {
  return {
    ...edge,
    selected: true,
    style: { ...edge.style, stroke: t.edgeSelected, strokeWidth: 2.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: t.edgeSelected, width: 18, height: 18 },
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
    <span className="select-none font-mono text-base font-semibold tracking-tight text-text-tertiary">
      flowstore
    </span>
  );
}

export type CanvasTokens = ReturnType<typeof useCanvasTokens>;

/**
 * The canvas plane, its floating chrome (controls, minimap) and every edge take
 * colours as JS strings, not classes, so they can't use the Tailwind token
 * utilities. Reading the custom properties off the root keeps tokens.css the
 * single source of truth rather than duplicating hexes here; re-reading is keyed
 * on the resolved theme, which the store writes to `data-theme` *before* it
 * updates state, so the values are current by the time this recomputes.
 *
 * Only the FlowNode escapes this — it renders real DOM, so it uses the Tailwind
 * token utilities directly and never appears here.
 */
function useCanvasTokens() {
  const resolved = useThemeStore((s) => s.resolved);
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string) => cs.getPropertyValue(name).trim();
    return {
      bg: v("--canvas-bg"),
      dot: v("--canvas-dot"),
      minimapBg: v("--minimap-bg"),
      minimapNode: v("--minimap-node"),
      minimapMask: v("--minimap-mask"),
      // Edge strokes. `byFlowType` mirrors the FlowNode border palette so an
      // edge visually inherits the node it points at.
      edgeByFlowType: {
        happy: v("--flow-happy-line"),
        sad: v("--flow-sad-line"),
        off: v("--flow-off-line"),
        utility: v("--flow-utility-line"),
        interrupt: v("--flow-interrupt-line"),
      } as Record<string, string>,
      edgeDefault: v("--edge-default"),
      edgeSelected: v("--edge-selected"),
      edgeError: v("--edge-error"),
      edgeWarning: v("--edge-warning"),
      edgeActive: v("--edge-active"),
      edgeActiveGlow: v("--edge-active-glow"),
      edgeTraversed: v("--edge-traversed"),
      edgeAssistant: v("--edge-assistant"),
      edgeAssistantGlow: v("--edge-assistant-glow"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);
}

const SAVE_DEBOUNCE_MS = 300;

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function buildGraph(spec: Spec, t: CanvasTokens): { nodes: Node[]; edges: Edge[] } {
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
      // Edge colour follows the destination flow's type, unless the edge itself
      // has something to report — an issue outranks the taxonomy.
      const stroke =
        edgeLevel === "error"
          ? t.edgeError
          : edgeLevel === "warning"
            ? t.edgeWarning
            : (t.edgeByFlowType[targetType ?? ""] ?? t.edgeDefault);
      const label = xp.condition?.expression
        ? truncate(xp.condition.expression, 32)
        : undefined;
      edges.push({
        id: edgeId,
        source: f.id,
        target: xp.goto,
        type: "parallel",
        // Carried so later styling passes can tell an issue-colored stroke
        // from a plain type-colored one (issues must not be restyled over).
        data: { issueLevel: edgeLevel },
        label,
        // Colours deliberately omitted: an inline `fill` would beat the
        // themed rules in globals.css, and the label chip sits on the canvas
        // plane, so it has to follow the plane between light and dark.
        labelStyle: { fontSize: 11 },
        // --edge-w is the resting weight; an edge carrying an issue steps up to
        // --edge-w-active so severity is not colour-alone here either.
        style: {
          stroke,
          strokeWidth: edgeLevel ? "var(--edge-w-active)" : "var(--edge-w)",
        },
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
  // Lone edges render with React Flow's built-in default bezier (cleaner than
  // the custom path); only siblings sharing a source→target pair need the
  // perpendicular fan-out to avoid overlapping.
  for (const group of groups.values()) {
    if (group.length === 1) {
      group[0].type = undefined; // built-in default edge type
      continue;
    }
    group.forEach((e, i) => {
      e.type = "parallel";
      e.data = { ...(e.data ?? {}), offsetIndex: i, offsetCount: group.length };
    });
  }

  return { nodes, edges };
}

export function Canvas() {
  const spec = useSpecStore((s) => s.spec);
  if (!spec) return <EmptyCanvas />;
  return <CanvasInner spec={spec} />;
}

function EmptyCanvas() {
  const t = useCanvasTokens();
  const [error, setError] = useState<string | null>(null);

  // Zero-state rescue, same design as compare's: a bundled example fetched
  // same-origin (local, instant, no accounts). GitHub serves power users; the
  // blank screen serves strangers.
  async function loadExample() {
    setError(null);
    try {
      const files = (await (
        await fetch("/examples/coffee.flowstore.json")
      ).json()) as Record<string, string>;
      const { spec, comments, testingArtifacts, modelsConfig, errors } = loadProject(files);
      if (!spec) {
        setError(errors[0]?.message ?? "Example failed to load.");
        return;
      }
      // Portable-artifact policy (confirm/clear/re-baseline) — the example is
      // an import like any other; without the re-baseline it would show as
      // unsaved before the user touches anything.
      loadPortableSpec(spec, { testingArtifacts, comments, modelsConfig });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Example failed to load.");
    }
  }

  return (
    <div className="relative w-full h-full bg-surface-canvas">
      <ReactFlow
        nodes={[]}
        edges={[]}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background gap={20} size={1} color={t.dot} bgColor={t.bg} />
        <Panel position="top-left">
          <BrandMark />
        </Panel>
      </ReactFlow>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="pointer-events-auto flex flex-col items-center gap-3 text-center">
          <div className="text-sm text-text-tertiary">
            Add a flow with +, import a project, or start from the example.
          </div>
          <button
            onClick={() => void loadExample()}
            className="rounded-full border border-border-default bg-surface-panel px-4 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-hover"
          >
            load example (coffee agent)
          </button>
          {error && <div className="text-xs text-state-error-fg">{error}</div>}
        </div>
      </div>
      <NodeActionBar />
    </div>
  );
}

// The extraction-at-graduation affordance: an imported project (full-override
// prompt, zero flows) lands on an empty canvas — this offers to mint the
// graph from the prompt. The imported text stays agent.system_prompt verbatim
// (the override still compiles to itself — the graph is a projection for
// review, never the system under test).
function GenerateFlowsOverlay({ spec }: { spec: Spec }) {
  const setSpec = useSpecStore((s) => s.setSpec);
  const model = useSettingsStore((s) => s.chatModel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    const d = resolveDispatch(model);
    if (!d.provider || !d.apiKey.trim()) {
      setError("Generating flows needs an API key for the assistant model (settings).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await parseSourceToSpec(
        d.provider,
        d.apiKey,
        d.wireModel,
        [{ name: "system-prompt.txt", content: spec.agent.system_prompt ?? "" }],
        "This is the production system prompt of an existing conversational agent, imported verbatim. Extract its behavioral spec — flows, guardrails, capabilities, variables — from the prompt text.",
        { baseUrl: d.baseUrl },
      );
      if (!res.ok) {
        setError(res.errors?.length ? `${res.error}: ${res.errors[0]}` : res.error);
        return;
      }
      // setSpec (not loadSpec): tests/golds/comments imported with the study
      // must survive extraction. Identity and the verbatim override prompt are
      // preserved — extraction structures the project, it never rewrites the
      // system under test.
      setSpec({
        ...res.spec,
        agent: {
          ...res.spec.agent,
          id: spec.agent.id,
          system_prompt: spec.agent.system_prompt,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="pointer-events-auto flex max-w-md flex-col items-center gap-3 text-center">
        <div className="text-sm text-text-tertiary">
          This project has an imported prompt and no flows yet. Generate the flow graph from
          the prompt.
        </div>
        <Button variant="primary" onClick={() => void generate()} loading={busy}>
          {busy ? "generating flows…" : "generate flows"}
        </Button>
        {error && <div className="text-xs text-state-error-fg">{error}</div>}
      </div>
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

function CanvasInner({ spec }: { spec: Spec }) {
  const specId = spec.agent.id;
  const t = useCanvasTokens();
  const minimapVisible = useUiStore((s) => s.minimapVisible);

  // `t` is memoized on the resolved theme, so this rebuilds on a theme switch —
  // which is exactly what repaints the edge strokes. Node positions survive it:
  // resolvePositions reads them back from the debounced save.
  const initial = useMemo(() => {
    const g = buildGraph(spec, t);
    const saved = loadPositions(specId);
    return { nodes: resolvePositions(g.nodes, g.edges, saved), edges: g.edges };
  }, [spec, specId, t]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const traversedEdgeIds = useSimulateStore((s) => s.traversedEdgeIds);
  const simulateStatus = useSimulateStore((s) => s.status);
  const assistantEdgeIds = useAssistantChangesStore((s) => s.glowEdgeIds);
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
    const selectedEdgeId =
      selection?.kind === "edge" ? `${selection.flowId}__${selection.exitPathId}` : null;
    const assistantGlow = new Set(assistantEdgeIds);
    setEdges(
      initial.edges.map((e) => {
        // Sim traversal outranks assistant glow: mid-run liveness is the
        // scarcer signal. Issue strokes also outrank it — assistant edits are
        // exactly the ones that create transient invalid states, and hiding a
        // red edge under a purple glow for the glow window would bury the one
        // signal that needs acting on. (Nodes get both: border stays red while
        // the halo glows; an edge has only one stroke, so issues win outright.)
        // Selection outranks everything, matching node rings.
        const hasIssue = Boolean((e.data as { issueLevel?: "error" | "warning" })?.issueLevel);
        const styled = traversed.has(e.id)
          ? withTraversed(e, e.id === lastId && isLive, t)
          : assistantGlow.has(e.id) && !hasIssue
            ? withAssistantGlow(e, t)
            : e;
        return e.id === selectedEdgeId ? withSelected(styled, t) : styled;
      }),
    );
  }, [initial, traversedEdgeIds, simulateStatus, assistantEdgeIds, selection, setEdges, t]);

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

  // Imported project (full-override prompt, zero flows): offer extraction.
  // Same predicate the validator uses to suppress its advisories.
  const importedFlowless = isImportedFlowless(spec);

  return (
    <div className="relative w-full h-full bg-surface-canvas">
      {importedFlowless && <GenerateFlowsOverlay spec={spec} />}
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
        // Cap the mount-time fit at 1:1 like the spec-swap refit below —
        // uncapped, a two-node graph fills the viewport at 2x.
        fitViewOptions={{ padding: 0.2, maxZoom: 1.0 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color={t.dot} bgColor={t.bg} />
        {/* The wordmark moves to the top-left corner the "+" vacated: the
            bottom-left is now the navigation cluster (zoom controls + minimap
            side by side), and a brand mark has no business inside it. */}
        <Panel position="top-left">
          <BrandMark />
        </Panel>
        <FocusOnRequest nodes={nodes} />
        <FitOnSpecChange specId={specId} />
        <Controls position="bottom-left" showInteractive={false}>
          <ControlButton onClick={relayout} title="Re-run auto layout">
            <RelayoutIcon />
          </ControlButton>
        </Controls>
        {/* Minimap joins the controls rather than sitting in the opposite
            corner — both answer "where am I", so they belong to each other.
            The inline marginLeft overrides (not adds to) the panel class's
            `margin: 15px`, so it has to account for the controls' own 15px
            left offset itself: 15 + 30 wide + an 8px gap = 53.
            height matches the controls stack (4 buttons × --hit-canvas) so
            the two sit flush along the bottom edge. */}
        {minimapVisible && (
          <MiniMap
            position="bottom-left"
            style={{ marginLeft: 53, width: 160, height: 120 }}
            pannable
            zoomable
            bgColor={t.minimapBg}
            nodeColor={t.minimapNode}
            maskColor={t.minimapMask}
          />
        )}
      </ReactFlow>
      <NodeActionBar />
    </div>
  );
}
