import type { ReactNode } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icon } from "./Icon";

export type MetricTone = "neutral" | "success" | "warning" | "error";

const TONE: Record<MetricTone, string> = {
  neutral: "text-text-primary",
  success: "text-state-success-fg",
  warning: "text-state-warning-fg",
  error: "text-state-error-fg",
};

export interface MetricStatProps {
  label: string;
  value: ReactNode;
  /** Always explicit, never implied: "ms", "tokens", "$". */
  unit?: string;
  /** Comparison line, e.g. "+38 ms vs last run". */
  delta?: string;
  tone?: MetricTone;
  icon?: PhosphorIcon;
  className?: string;
}

/**
 * Labelled numeric readout for run summaries — latency, tokens, cost, turn
 * counts. The value is tabular so it can tick in place without reflowing the
 * row next to it.
 */
export function MetricStat({
  label,
  value,
  unit,
  delta,
  tone = "neutral",
  icon,
  className,
}: MetricStatProps) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5${className ? ` ${className}` : ""}`}>
      <span className="fs-caption flex items-center gap-1 text-text-tertiary">
        {icon && <Icon icon={icon} size={12} color="var(--text-disabled)" />}
        {label}
      </span>
      <span className={`fs-metric flex items-baseline gap-[3px] ${TONE[tone]}`}>
        {value}
        {unit && <span className="fs-data text-text-tertiary">{unit}</span>}
      </span>
      {delta && <span className="fs-micro text-text-tertiary tabular">{delta}</span>}
    </div>
  );
}
