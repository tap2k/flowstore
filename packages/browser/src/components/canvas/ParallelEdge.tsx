import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";

// Spacing (px) between parallel edges that share the same source→target pair.
const SPACING = 28;

/**
 * Edge that fans out when multiple exits connect the same two flows.
 *
 * React Flow draws two default edges with the same source/target on the
 * identical path, so they overlap exactly and look like one — silently hiding
 * exits (e.g. a flow with both `xp_50p_cannot_pay_anything` and
 * `xp_50p_date_after_grace` → `unable_to_pay`). This edge offsets each sibling
 * perpendicular to the source→target line by its index in the group, so every
 * exit (and its label) is visible and individually clickable.
 *
 * `data.offsetIndex` / `data.offsetCount` are assigned by the edge builder.
 * A single edge (count 1, index 0) renders as a straight line.
 */
export function ParallelEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  label,
  labelStyle,
  labelBgStyle,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const idx = (data?.offsetIndex as number) ?? 0;
  const count = (data?.offsetCount as number) ?? 1;

  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  // unit vector perpendicular to the source→target direction
  const px = -dy / len;
  const py = dx / len;
  const spread = (idx - (count - 1) / 2) * SPACING;

  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;
  const offX = midX + px * spread;
  const offY = midY + py * spread;

  // Quadratic bezier whose midpoint passes through the offset point.
  // For B(0.5) = (P0 + 2C + P2)/4 to equal (offX,offY): C = 2*off - mid.
  const cx = 2 * offX - midX;
  const cy = 2 * offY - midY;
  const path = `M ${sourceX},${sourceY} Q ${cx},${cy} ${targetX},${targetY}`;

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${offX}px, ${offY}px)`,
              fontSize: 11,
              color: "#52525b",
              background: "#fafafa",
              padding: "0 3px",
              borderRadius: 3,
              pointerEvents: "all",
              ...(labelStyle as Record<string, unknown>),
              ...(labelBgStyle as Record<string, unknown>),
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
