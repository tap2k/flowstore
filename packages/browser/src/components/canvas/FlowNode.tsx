import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowType } from "@flowstore/core/schema/v0";
import { useSimulateStore } from "@/lib/store/simulate";
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

// Border + ring classes for a node carrying issues (red = error, amber = warning).
function issueBorder(level: "error" | "warning" | undefined, fallback: string): string {
  return level === "error" ? "border-red-500" : level === "warning" ? "border-amber-500" : fallback;
}
function issueRing(level: "error" | "warning" | undefined): string | null {
  return level === "error" ? "ring-1 ring-red-300 shadow-sm" : level === "warning" ? "ring-1 ring-amber-300 shadow-sm" : null;
}

const typeStyles: Record<FlowType, { border: string; badge: string; label: string }> = {
  happy:     { border: "border-emerald-400", badge: "bg-emerald-100 text-emerald-800", label: "happy" },
  sad:       { border: "border-amber-400",   badge: "bg-amber-100 text-amber-800",     label: "sad" },
  off:       { border: "border-zinc-400",    badge: "bg-zinc-100 text-zinc-800",       label: "off" },
  utility:   { border: "border-sky-400",     badge: "bg-sky-100 text-sky-800",         label: "utility" },
  interrupt: { border: "border-violet-400",  badge: "bg-violet-100 text-violet-800",   label: "interrupt" },
};

export function FlowNode({ id, data, selected }: NodeProps & { data: FlowNodeData }) {
  const style = typeStyles[data.flowType];
  const hasIssues = (data.issues?.length ?? 0) > 0;
  const issueTitle = hasIssues ? data.issues!.join("\n") : undefined;
  const level = data.issueLevel;
  const isActive = useSimulateStore((s) => s.currentFlowId === id);
  const unresolvedComments = useCommentsStore(
    (s) => (s.commentsByAnchor.get(`flow/${id}`) ?? []).filter((c) => !c.resolved).length,
  );

  if (data.isJunction) {
    return (
      <JunctionNode
        id={id}
        name={data.name}
        issueLevel={level}
        issueTitle={issueTitle}
        isActive={isActive}
        selected={selected}
      />
    );
  }

  return (
    <div
      title={issueTitle}
      className={`relative rounded-md border-2 ${issueBorder(level, style.border)} bg-white px-3.5 py-2.5 min-w-[200px] max-w-[260px] text-left ${
        selected
          ? "ring-2 ring-zinc-900 ring-offset-1 shadow-md"
          : isActive
          ? "ring-2 ring-sky-500 ring-offset-1 shadow-md"
          : issueRing(level) ?? "shadow-sm"
      }`}
    >
      {unresolvedComments > 0 && <CommentBadge count={unresolvedComments} />}
      <Handle type="target" position={Position.Left} className="!bg-zinc-400" />
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${style.badge}`}>
          {style.label}
        </span>
        {data.isEntry && (
          <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-black text-white">
            entry
          </span>
        )}
      </div>
      <div className="text-sm font-medium text-zinc-900 leading-tight">{data.name}</div>
      <Handle
        type="source"
        position={Position.Right}
        title="Drag to connect this flow to another"
        className="!h-3.5 !w-3.5 !border-2 !border-zinc-400 !bg-white cursor-crosshair shadow-sm transition-transform hover:!scale-125 hover:!border-zinc-600"
      />
    </div>
  );
}

function JunctionNode({
  name,
  issueLevel,
  issueTitle,
  isActive,
  selected,
}: {
  id: string;
  name: string;
  issueLevel: "error" | "warning" | undefined;
  issueTitle: string | undefined;
  isActive: boolean;
  selected: boolean;
}) {
  // Rotated square renders as a diamond. The label sits in a counter-rotated
  // wrapper above so it stays upright. Width/height are equal so the bounding
  // box is symmetric — the handles attach at the rotated mid-points (which are
  // the visual side tips of the diamond).
  const ring =
    issueRing(issueLevel) ??
    (selected
      ? "ring-2 ring-zinc-900 ring-offset-1 shadow-md"
      : isActive
        ? "ring-2 ring-sky-500 ring-offset-1 shadow-md"
        : "shadow-sm");
  const border = issueBorder(issueLevel, "border-sky-400");

  return (
    <div className="relative" title={issueTitle} style={{ width: 96, height: 96 }}>
      <div
        className={`absolute border-2 ${border} bg-white ${ring}`}
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
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-zinc-400"
        style={{ top: "50%" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        title="Drag to connect this flow to another"
        className="!h-3.5 !w-3.5 !border-2 !border-zinc-400 !bg-white cursor-crosshair shadow-sm transition-transform hover:!scale-125 hover:!border-zinc-600"
        style={{ top: "50%" }}
      />
      <div className="absolute inset-0 flex items-center justify-center px-2 text-center">
        <span className="text-[10px] font-medium leading-tight text-zinc-700">{name}</span>
      </div>
    </div>
  );
}

function CommentBadge({ count }: { count: number }) {
  return (
    <span
      title={`${count} unresolved comment${count === 1 ? "" : "s"}`}
      className="absolute -top-2 -right-2 z-10 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-medium text-white shadow"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
