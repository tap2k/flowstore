import { X } from "@phosphor-icons/react";
import { IconButton } from "./IconButton";
import { StatusIcon, type Status } from "./StatusIcon";

export interface ToastProps {
  status?: Extract<Status, "success" | "error" | "warning" | "running" | "idle">;
  /**
   * ≤ 8 words, past tense, no terminal punctuation: "Agent deployed to
   * production", "3 nodes deleted".
   */
  message: string;
  /** Undo is an action in the toast, not a sentence about undo. */
  actionLabel?: string;
  action?: () => void;
  onDismiss?: () => void;
  className?: string;
}

/** Level-2 transient confirmation. */
export function Toast({
  status = "success",
  message,
  action,
  actionLabel,
  onDismiss,
  className,
}: ToastProps) {
  return (
    <div
      role="status"
      className={[
        "flex min-h-9 animate-fs-pop-in items-center gap-2 rounded-3 border border-border-default bg-surface-raised py-0 pl-2.5 pr-1.5 shadow-elev-2",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <StatusIcon status={status} size={14} />
      <span className="fs-ui whitespace-nowrap text-text-primary">{message}</span>
      {actionLabel && (
        <button
          type="button"
          onClick={action}
          className="fs-control cursor-pointer border-none bg-transparent px-1 text-text-primary underline decoration-n-6 underline-offset-2 hover:decoration-current"
        >
          {actionLabel}
        </button>
      )}
      {onDismiss && <IconButton icon={X} label="Dismiss" size="sm" onClick={onDismiss} />}
    </div>
  );
}
