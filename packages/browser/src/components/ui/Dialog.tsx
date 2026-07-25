import { useEffect, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open?: boolean;
  /**
   * Names the consequence, not "Are you sure?" — "Delete 4 nodes?".
   */
  title: string;
  /** Names what is lost: "Their connections will be removed. This can't be undone." */
  description?: string;
  children?: ReactNode;
  /** Buttons, right-aligned, the destructive/confirm action last. */
  footer?: ReactNode;
  width?: number;
  onClose?: () => void;
  className?: string;
}

/** Level-3 modal over a scrim. Centred in the viewport, never in the canvas. */
export function Dialog({
  open = true,
  title,
  description,
  children,
  footer,
  width = 440,
  onClose,
  className,
}: DialogProps) {
  // Escape closes. Registered on the document rather than the dialog node so it
  // works before anything inside has received focus.
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-90 flex animate-fs-fade-in items-center justify-center bg-surface-scrim"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ width }}
        className={[
          "flex max-h-[calc(100vh-64px)] max-w-[calc(100vw-32px)] animate-fs-pop-in flex-col",
          "rounded-4 border border-border-default bg-surface-raised shadow-elev-3",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <header className="flex items-start gap-3 p-4 pb-0">
          <div className="min-w-0 flex-1">
            <h2 className="fs-pageTitle m-0 text-text-primary">{title}</h2>
            {description && (
              <p className="fs-body m-0 mt-1.5 text-pretty text-text-secondary">{description}</p>
            )}
          </div>
          {onClose && <IconButton icon={X} label="Close" size="sm" onClick={onClose} />}
        </header>
        {children && <div className="min-h-0 overflow-auto px-4 pt-3.5">{children}</div>}
        {footer && <footer className="flex justify-end gap-2 p-4">{footer}</footer>}
      </div>
    </div>
  );
}
