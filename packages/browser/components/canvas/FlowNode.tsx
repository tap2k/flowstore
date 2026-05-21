import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowType } from "@ux4/core/schema/v0";
import { useSimulateStore } from "@/lib/store/simulate";

export interface FlowNodeData {
  name: string;
  flowType: FlowType;
  isEntry: boolean;
  isJunction: boolean;
  issues?: string[];
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
  const isActive = useSimulateStore((s) => s.currentFlowId === id);

  if (data.isJunction) {
    return (
      <JunctionNode
        id={id}
        name={data.name}
        hasIssues={hasIssues}
        issueTitle={issueTitle}
        isActive={isActive}
        selected={selected}
      />
    );
  }

  return (
    <div
      title={issueTitle}
      className={`rounded-md border-2 ${
        hasIssues ? "border-red-500" : style.border
      } bg-white px-3.5 py-2.5 min-w-[200px] max-w-[260px] text-left ${
        selected
          ? "ring-2 ring-zinc-900 ring-offset-1 shadow-md"
          : isActive
          ? "ring-2 ring-sky-500 ring-offset-1 shadow-md"
          : hasIssues
          ? "ring-1 ring-red-300 shadow-sm"
          : "shadow-sm"
      }`}
    >
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
      <Handle type="source" position={Position.Right} className="!bg-zinc-400" />
    </div>
  );
}

function JunctionNode({
  name,
  hasIssues,
  issueTitle,
  isActive,
  selected,
}: {
  id: string;
  name: string;
  hasIssues: boolean;
  issueTitle: string | undefined;
  isActive: boolean;
  selected: boolean;
}) {
  // Rotated square renders as a diamond. The label sits in a counter-rotated
  // wrapper above so it stays upright. Width/height are equal so the bounding
  // box is symmetric — the handles attach at the rotated mid-points (which are
  // the visual side tips of the diamond).
  const ring = hasIssues
    ? "ring-1 ring-red-300 shadow-sm"
    : selected
      ? "ring-2 ring-zinc-900 ring-offset-1 shadow-md"
      : isActive
        ? "ring-2 ring-sky-500 ring-offset-1 shadow-md"
        : "shadow-sm";
  const border = hasIssues ? "border-red-500" : "border-sky-400";

  return (
    <div className="relative" title={issueTitle} style={{ width: 96, height: 96 }}>
      <div
        className={`absolute inset-0 rotate-45 border-2 ${border} bg-white ${ring}`}
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
        className="!bg-zinc-400"
        style={{ top: "50%" }}
      />
      <div className="absolute inset-0 flex items-center justify-center px-2 text-center">
        <span className="text-[10px] font-medium leading-tight text-zinc-700">{name}</span>
      </div>
    </div>
  );
}
