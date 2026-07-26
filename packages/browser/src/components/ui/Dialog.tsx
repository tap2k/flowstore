import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

// Everything focusable we can reach without walking shadow roots. Used for both
// the initial focus target and the Tab cycle.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Level-3 modal over a scrim. Centred in the viewport, never in the canvas. */
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
  const panel = useRef<HTMLDivElement>(null);
  // Where focus was before the dialog opened, so it can be handed back. Set on
  // open and cleared on close — holding it across opens would eventually restore
  // focus to an element that no longer exists.
  const restoreTo = useRef<HTMLElement | null>(null);
  // A drag that starts inside the panel and ends over the scrim is a text
  // selection overshooting its container, not a dismissal. `click` fires on the
  // common ancestor in that case, so the origin of the press is what decides.
  const pressedScrim = useRef(false);

  const focusables = useCallback(
    () => Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  // Move focus in on open, hand it back on close.
  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    // The panel itself is the fallback target: a dialog with no controls (a
    // progress message, say) still has to take focus off the page behind it.
    (focusables()[0] ?? panel.current)?.focus();
    return () => {
      restoreTo.current?.focus?.();
      restoreTo.current = null;
    };
  }, [open, focusables]);

  // Escape closes; Tab cycles within the panel. Registered on the document
  // rather than the panel so both work before anything inside has been clicked.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      const inside = panel.current?.contains(document.activeElement);
      if (items.length === 0) {
        // Nothing to cycle between — hold focus on the panel rather than let
        // Tab escape to the page behind the scrim.
        e.preventDefault();
        panel.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // `!inside` also catches focus resting on the panel itself, which would
      // otherwise Tab straight out into the page behind.
      if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, focusables]);

  if (!open) return null;

  // Portalled to <body>: an ancestor with `transform`, `filter` or
  // `overflow: hidden` would otherwise clip the scrim or trap the panel.
  return createPortal(
    <div
      className="fixed inset-0 z-90 flex animate-fs-fade-in items-center justify-center bg-surface-scrim"
      onMouseDown={(e) => {
        pressedScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedScrim.current) onClose?.();
        pressedScrim.current = false;
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
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
    </div>,
    document.body,
  );
}
