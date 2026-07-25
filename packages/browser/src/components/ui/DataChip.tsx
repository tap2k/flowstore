import type { ReactNode } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icon } from "./Icon";

export interface DataChipProps {
  children?: ReactNode;
  /** Key half of a key:value pair, in tertiary prose weight inside the chip. */
  label?: string;
  icon?: PhosphorIcon;
  tone?: "neutral" | "error";
  className?: string;
}

/**
 * Inline machine value — variable names, model IDs, single numeric config
 * values. This is the one-typeface answer to inline `<code>`: the container and
 * the data typography carry the distinction that a monospace face would have.
 */
export function DataChip({ children, label, icon, tone = "neutral", className }: DataChipProps) {
  const err = tone === "error";
  return (
    <span
      className={[
        "fs-data inline-flex items-center gap-1 whitespace-nowrap rounded-1 border px-[5px] py-px",
        err
          ? "border-state-error-line bg-state-error-bg text-state-error-fg"
          : "border-border-subtle bg-surface-sunken text-text-primary",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon && <Icon icon={icon} weight="bold" size={11} color="var(--text-tertiary)" />}
      {label && <span className="fs-caption text-text-tertiary">{label}</span>}
      {children}
    </span>
  );
}
