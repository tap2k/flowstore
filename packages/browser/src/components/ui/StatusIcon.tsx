import {
  CheckCircle,
  Circle,
  Clock,
  PauseCircle,
  Prohibit,
  SpinnerGap,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
import { Icon, type IconWeight } from "./Icon";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

export type Status =
  | "idle"
  | "queued"
  | "running"
  | "success"
  | "error"
  | "warning"
  | "disabled"
  | "breakpoint";

// Colour is never the only carrier of state. Each status also has a distinct
// SILHOUETTE — open circle, clock face, notched ring, check-in-circle,
// x-in-circle, filled triangle, slashed circle, pause bars — all mutually
// distinguishable in monochrome at 12px. If you can't tell the state in a
// greyscale screenshot, the state isn't done.
const MAP: Record<Status, { glyph: PhosphorIcon; weight: IconWeight; color: string; spin?: boolean }> = {
  idle: { glyph: Circle, weight: "regular", color: "var(--state-idle-fg)" },
  queued: { glyph: Clock, weight: "regular", color: "var(--state-idle-fg)" },
  running: { glyph: SpinnerGap, weight: "bold", color: "var(--state-running-fg)", spin: true },
  success: { glyph: CheckCircle, weight: "fill", color: "var(--state-success-fg)" },
  error: { glyph: XCircle, weight: "fill", color: "var(--state-error-fg)" },
  warning: { glyph: Warning, weight: "fill", color: "var(--state-warning-fg)" },
  disabled: { glyph: Prohibit, weight: "regular", color: "var(--state-disabled-fg)" },
  breakpoint: { glyph: PauseCircle, weight: "fill", color: "var(--text-secondary)" },
};

export interface StatusIconProps {
  status?: Status;
  /** Defaults to 12px — the size a status reads at inside a node header. */
  size?: number;
  /** Accessible label. Defaults to the status name. */
  title?: string;
  className?: string;
}

/** Status glyph: silhouette + colour together, never colour alone. */
export function StatusIcon({ status = "idle", size = 12, title, className }: StatusIconProps) {
  const { glyph, weight, color, spin } = MAP[status];
  return (
    <Icon
      icon={glyph}
      weight={weight}
      size={size}
      color={color}
      title={title ?? status}
      // motion-reduce is belt-and-braces: tokens.css already collapses all
      // animation under prefers-reduced-motion, and a frozen spinner still
      // reads as "running" because the notched ring is its own silhouette.
      className={`${spin ? "animate-fs-spin motion-reduce:animate-none" : ""}${
        className ? ` ${className}` : ""
      }`}
    />
  );
}
