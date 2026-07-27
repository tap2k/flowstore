import { type ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";
import { IconButton } from "./IconButton";

export interface DialogProps {
  /**
   * Required, not defaulted. A dialog that renders itself open when the prop is
   * forgotten is a footgun: the mistake surfaces as a modal nobody can explain
   * rather than as a type error.
   */
  open: boolean;
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

/**
 * Level-3 modal over a scrim. Centred in the viewport, never in the canvas.
 *
 * Behavior comes from the Radix Dialog primitive — focus trap and restore,
 * Escape, outside-press dismissal (press-origin aware, so a text selection
 * dragged out of an input doesn't dismiss), portal, and title/description
 * ARIA wiring. This file owns only the visual layer, in tokens.
 */
export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  width = 440,
  onClose,
  className,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-90 animate-fs-fade-in bg-surface-scrim" />
        <RadixDialog.Content
          style={{ width }}
          // Radix warns when Content has no Description; the explicit undefined
          // opts out of the wiring only when there is genuinely no description.
          {...(description ? {} : { "aria-describedby": undefined })}
          className={[
            "fixed left-1/2 top-1/2 z-90 -translate-x-1/2 -translate-y-1/2",
            "flex max-h-[calc(100vh-64px)] max-w-[calc(100vw-32px)] animate-fs-pop-in flex-col",
            "rounded-4 border border-border-default bg-surface-raised shadow-elev-3",
            className ?? "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <header className="flex items-start gap-3 p-4 pb-0">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="fs-pageTitle m-0 text-text-primary">
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="fs-body m-0 mt-1.5 text-pretty text-text-secondary">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            {onClose && <IconButton icon={X} label="Close" size="sm" onClick={onClose} />}
          </header>
          {children && <div className="min-h-0 overflow-auto px-4 pt-3.5">{children}</div>}
          {footer && <footer className="flex justify-end gap-2 p-4">{footer}</footer>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
