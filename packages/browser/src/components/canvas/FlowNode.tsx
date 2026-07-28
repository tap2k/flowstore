import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChatCircle } from "@phosphor-icons/react";
import type { FlowType } from "@flowstore/core/schema/v0";
import type { ResolvedAttribution } from "@flowstore/core/runtime/flowWatcher";
import { Icon } from "@/components/ui/Icon";
import { StatusIcon } from "@/components/ui/StatusIcon";
import { useSimulateStore } from "@/lib/store/simulate";
import { useAssistantChangesStore } from "@/lib/store/assistantChanges";
import { useCommentsStore } from "@/lib/store/comments";

export interface FlowNodeData {
  name: string;
  flowType: FlowType;
  isEntry: boolean;
  isJunction: boolean;
  issues?: string[];
  // Worst severity among this flow's issues — drives border/ring color.
  issueLevel?: "error" | "warning";
}

// Flow type styling. Each type owns a header tint, a border and an ink; the
// three come from the --flow-* token trio so they stay in step across themes
// and with the functional-state palette they alias (see tokens.css). Type is
// never colour-alone — the header spells the label out beside the swatch.
const typeStyles: Record<FlowType, { border: string; header: string; ink: string; label: string }> = {
  happy: {
    border: "border-flow-happy-line",
    header: "bg-flow-happy-bg",
    ink: "text-flow-happy-fg",
    label: "happy",
  },
  sad: {
    border: "border-flow-sad-line",
    header: "bg-flow-sad-bg",
    ink: "text-flow-sad-fg",
    label: "sad",
  },
  off: {
    border: "border-flow-off-line",
    header: "bg-flow-off-bg",
    ink: "text-flow-off-fg",
    label: "off",
  },
  utility: {
    border: "border-flow-utility-line",
    header: "bg-flow-utility-bg",
    ink: "text-flow-utility-fg",
    label: "utility",
  },
  interrupt: {
    border: "border-flow-interrupt-line",
    header: "bg-flow-interrupt-bg",
    ink: "text-flow-interrupt-fg",
    label: "interrupt",
  },
};

// A node carrying issues drops its type border for a state border. The severity
// also shows as a StatusIcon in the header, so the state survives greyscale.
function issueBorder(level: "error" | "warning" | undefined, fallback: string): string {
  return level === "error"
    ? "border-state-error-line"
    : level === "warning"
      ? "border-state-warning-line"
      : fallback;
}
function issueRing(level: "error" | "warning" | undefined): string | null {
  if (level === "error") return "ring-1 ring-state-error-line shadow-elev-node";
  if (level === "warning") return "ring-1 ring-state-warning-line shadow-elev-node";
  return null;
}

// The halo for the flow the sim is currently in. A thick ring competes with the
// node's own colored border, so the active state leans on a bright colored GLOW
// (a large soft box-shadow) that reads at a glance from across the canvas. In
// runner mode (or before the first attributed prompt-mode turn) `attr` is null →
// the full-strength active glow. In prompt mode the flow watcher supplies a
// confidence + status:
//  - illegal jump → alert glow, pulsing: the agent behaved like a flow the spec
//    can't reach from the previous one (off-spec, or a missing edge).
//  - otherwise confidence is rendered as texture, NOT a number — the glow fades
//    and the ring thins as certainty drops, and a genuine close call pulses. The
//    shimmer is the OBSERVER's uncertainty ("we're not sure it's here"), not a
//    claim about the model.
// The glows are box-shadows built from tokens, so they follow the theme; a
// glow's alpha is tuned per mode (the same rgba reads far dimmer on near-black).
const GLOW_ACTIVE = "shadow-[var(--signal-active-glow)]";
const GLOW_ACTIVE_SOFT = "shadow-[var(--signal-active-glow-soft)]";
const GLOW_ALERT = "shadow-[var(--signal-alert-glow)]";

function activeRingClass(attr: ResolvedAttribution | null): string {
  const strong = `ring-4 ring-signal-active-ring ring-offset-2 ring-offset-surface-canvas ${GLOW_ACTIVE}`;
  if (!attr) return strong;
  if (attr.status === "illegal")
    return `ring-4 ring-signal-alert-ring ring-offset-2 ring-offset-surface-canvas ${GLOW_ALERT} animate-pulse motion-reduce:animate-none`;
  const c = attr.confidence;
  if (c >= 0.66) return strong;
  if (c >= 0.33)
    return `ring-4 ring-signal-active-ring/70 ring-offset-2 ring-offset-surface-canvas ${GLOW_ACTIVE_SOFT}`;
  return `ring-2 ring-signal-active-ring/50 ring-offset-1 ring-offset-surface-canvas ${GLOW_ACTIVE_SOFT} animate-pulse motion-reduce:animate-none`;
}

// A human-readable reason for an alert/shimmer glow, appended to the node tooltip.
function attributionHint(attr: ResolvedAttribution | null): string | undefined {
  if (!attr) return undefined;
  if (attr.status === "illegal")
    return "Off-spec: the agent behaved like a flow the spec can't reach from the previous one.";
  if (attr.confidence < 0.33)
    return `Low-confidence attribution (${Math.round(attr.confidence * 100)}%) — this transition is a close call.`;
  return undefined;
}

// The halo for a flow the ASSISTANT just changed (see assistantChanges.ts).
// Violet: the established "AI did this" hue (sparkles), and — unlike red-ish
// hues — carries no error/danger reading. It doesn't fight the canvas
// palette: the active glow is the sim's live flow, selection is achromatic,
// error/warning are issues; interrupt flows use the same violet but as a thin
// BORDER, a different element from this soft outer halo. Steady (no pulse): in
// this app's vocabulary pulsing means live uncertainty, and "recently edited"
// is a fact, not a guess.
const ASSISTANT_GLOW =
  "ring-2 ring-signal-assistant-ring ring-offset-1 ring-offset-surface-canvas shadow-[var(--signal-assistant-glow)]";

// Selection is ACHROMATIC by design-system rule: colour is reserved for
// machine-reported state, so selecting a node never competes with a failing one.
const SELECTED_RING = "ring-2 ring-select-ring ring-offset-1 ring-offset-surface-canvas shadow-elev-2";

export function FlowNode({ id, data, selected }: NodeProps & { data: FlowNodeData }) {
  const style = typeStyles[data.flowType];
  const hasIssues = (data.issues?.length ?? 0) > 0;
  const issueTitle = hasIssues ? data.issues!.join("\n") : undefined;
  const level = data.issueLevel;
  const isActive = useSimulateStore((s) => s.currentFlowId === id);
  // Attribution belongs to the active flow only (attribution.flowId ===
  // currentFlowId, set together). null for non-active nodes and runner mode.
  const attribution = useSimulateStore((s) => (s.currentFlowId === id ? s.attribution : null));
  const assistantGlow = useAssistantChangesStore((s) => s.glowFlowIds.includes(id));
  const activeRing = activeRingClass(attribution);
  const hint = attributionHint(attribution);
  const title = [issueTitle, isActive ? hint : undefined].filter(Boolean).join("\n") || undefined;
  const unresolvedComments = useCommentsStore(
    (s) => (s.commentsByAnchor.get(`flow/${id}`) ?? []).filter((c) => !c.resolved).length,
  );

  if (data.isJunction) {
    return (
      <JunctionNode
        id={id}
        name={data.name}
        issueLevel={level}
        issueTitle={title}
        isActive={isActive}
        activeRing={activeRing}
        assistantGlow={assistantGlow}
        selected={selected}
        unresolvedComments={unresolvedComments}
      />
    );
  }

  return (
    <div
      title={title}
      // fs-node is the hook globals.css uses to draw the keyboard focus ring on
      // the visible card rather than on React Flow's wrapper.
      // Deliberately not overflow-hidden — the comment badge and both handles
      // sit outside the card. The header rounds its own top corners instead.
      className={`fs-node relative w-[var(--node-w)] rounded-3 border bg-surface-node text-left transition-shadow duration-[var(--dur-1)] ease-standard ${issueBorder(
        level,
        style.border,
      )} ${
        selected
          ? SELECTED_RING
          : isActive
            ? activeRing
            : assistantGlow
              ? ASSISTANT_GLOW
              : (issueRing(level) ?? "shadow-elev-node hover:shadow-elev-node-hover")
      }`}
    >
      {unresolvedComments > 0 && <CommentBadge count={unresolvedComments} />}
      <Handle type="target" position={Position.Left} />
      {/* Header: what KIND of flow this is, plus anything the machine has to
          report about it. The body below carries only the name, so the node
          title is never crowded by badges. */}
      <div
        // The inner radius is the card's minus its 1px border, so the tint
        // meets the border cleanly instead of leaving a hairline at the corner.
        className={`flex h-[var(--node-h-header)] items-center gap-[var(--gap-inline)] rounded-t-[calc(var(--r-3)-1px)] px-[var(--node-pad-x)] ${style.header}`}
      >
        <span className={`fs-micro uppercase ${style.ink}`}>{style.label}</span>
        <span className="ml-auto flex items-center gap-[var(--gap-inline)]">
          {data.isEntry && (
            <span className="fs-micro rounded-1 bg-emphasis px-1 uppercase text-emphasis-fg">
              entry
            </span>
          )}
          {level && (
            <StatusIcon
              status={level}
              size={13}
              title={level === "error" ? "Has errors" : "Has warnings"}
            />
          )}
        </span>
      </div>
      <div className="px-[var(--node-pad-x)] py-[var(--node-pad-body)]">
        <div className="fs-nodeTitle text-text-primary">{data.name}</div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        title="Drag to connect this flow to another"
      />
    </div>
  );
}

function JunctionNode({
  name,
  issueLevel,
  issueTitle,
  isActive,
  activeRing,
  assistantGlow,
  selected,
  unresolvedComments,
}: {
  id: string;
  name: string;
  issueLevel: "error" | "warning" | undefined;
  issueTitle: string | undefined;
  isActive: boolean;
  activeRing: string;
  assistantGlow: boolean;
  selected: boolean;
  unresolvedComments: number;
}) {
  // Rotated square renders as a diamond. The label sits in a counter-rotated
  // wrapper above so it stays upright. Width/height are equal so the bounding
  // box is symmetric — the handles attach at the rotated mid-points (which are
  // the visual side tips of the diamond).
  const ring =
    issueRing(issueLevel) ??
    (selected
      ? SELECTED_RING
      : isActive
        ? activeRing
        : assistantGlow
          ? ASSISTANT_GLOW
          : "shadow-elev-node");
  // A junction is a routing decision, so it wears the utility palette rather
  // than the type of any flow it routes to.
  const border = issueBorder(issueLevel, "border-flow-utility-line");

  return (
    <div className="fs-node relative" title={issueTitle} style={{ width: 96, height: 96 }}>
      {unresolvedComments > 0 && <CommentBadge count={unresolvedComments} />}
      <div
        className={`absolute rounded-1 border bg-flow-utility-bg ${border} ${ring}`}
        // 68 ≈ 96/√2 — sized so the rotated square's tips land exactly on the
        // 96px box edge midpoints, where the left/right handles attach.
        style={{
          width: 68,
          height: 68,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%) rotate(45deg)",
        }}
        aria-hidden
      />
      <Handle type="target" position={Position.Left} style={{ top: "50%" }} />
      <Handle
        type="source"
        position={Position.Right}
        title="Drag to connect this flow to another"
        style={{ top: "50%" }}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-center">
        <span className="fs-micro text-text-secondary">{name}</span>
      </div>
    </div>
  );
}

function CommentBadge({ count }: { count: number }) {
  return (
    <span
      title={`${count} unresolved comment${count === 1 ? "" : "s"}`}
      // Speech-bubble glyph, not colour alone — a comment count is a fact about
      // the node, not a severity, so it reads neutral rather than as a warning.
      className="fs-micro absolute -right-2 -top-2 z-10 inline-flex h-[18px] items-center gap-0.5 rounded-full border border-border-default bg-surface-raised pl-1 pr-1.5 tabular text-text-secondary shadow-elev-1"
    >
      <Icon icon={ChatCircle} weight="fill" size={11} />
      {count > 99 ? "99+" : count}
    </span>
  );
}
