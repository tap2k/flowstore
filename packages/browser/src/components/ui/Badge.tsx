import type { ReactNode } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icon } from "./Icon";
import { StatusIcon, type Status } from "./StatusIcon";

export type BadgeTone = "neutral" | "running" | "success" | "error" | "warning" | "disabled";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken border-border-subtle text-text-secondary",
  running: "bg-state-running-bg border-state-running-line text-state-running-fg",
  success: "bg-state-success-bg border-state-success-line text-state-success-fg",
  error: "bg-state-error-bg border-state-error-line text-state-error-fg",
  warning: "bg-state-warning-bg border-state-warning-line text-state-warning-fg",
  disabled: "bg-state-disabled-bg border-state-disabled-line text-state-disabled-fg",
};

const STATUS_TONE: Record<Status, BadgeTone> = {
  idle: "neutral",
  queued: "neutral",
  running: "running",
  success: "success",
  error: "error",
  warning: "warning",
  disabled: "disabled",
  breakpoint: "neutral",
};

export interface BadgeProps {
  children?: ReactNode;
  tone?: BadgeTone;
  /**
   * Sets the tone AND adds the mandated status glyph. Prefer this over `tone`
   * for machine-reported state — it is what keeps the badge from being
   * colour-only.
   */
  status?: Status;
  icon?: PhosphorIcon;
  className?: string;
}

/** 18px micro label. */
export function Badge({ children, tone, status, icon, className }: BadgeProps) {
  const resolved = tone ?? (status ? STATUS_TONE[status] : "neutral");
  return (
    <span
      className={[
        "fs-micro inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-1 border px-1.5 tabular",
        TONE[resolved],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {status ? (
        <StatusIcon status={status} size={11} />
      ) : icon ? (
        <Icon icon={icon} weight="bold" size={11} />
      ) : null}
      {children}
    </span>
  );
}
