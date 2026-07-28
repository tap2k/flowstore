import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui";

interface SheetShellProps {
  title: string;
  inlineMeta?: ReactNode;
  subtitle?: string;
  onClose: () => void;
  /** Modal-only. Ignored when docked, where the panel width is the dock width. */
  maxWidth?: string;
  headerActions?: ReactNode;
  footer?: ReactNode;
  bodyClass?: string;
  /**
   * Render as the docked left panel instead of a modal. Same header / body /
   * footer contract either way — only the chrome around it changes, so a
   * section editor never needs two implementations.
   */
  docked?: boolean;
  children: ReactNode;
}

/**
 * What every spec-section editor takes. They are rendered from two places —
 * the docked left panel and (for the few still reachable that way) a modal —
 * so the pair travels together rather than each sheet inventing its own props.
 */
export interface SectionSheetProps {
  onClose: () => void;
  docked?: boolean;
}

const DEFAULT_BODY_CLASS = "flex-1 overflow-auto px-5 py-4 space-y-6";
// Docked is ~320px against the modal's 672-768px, so the generous modal gutters
// would eat a tenth of the usable width.
const DOCKED_BODY_CLASS = "flex-1 overflow-auto px-3 py-3 space-y-5";

/**
 * The shared shell for every spec section editor, in both of its homes: a
 * level-3 modal, and the docked left panel the rail tabs into.
 *
 * Built on the design system's surfaces and elevation rather than the Dialog
 * atom: sheets are editors with their own scroll region, header actions and
 * footer, where Dialog is sized for a decision.
 */
export function SheetShell({
  title,
  inlineMeta,
  subtitle,
  onClose,
  maxWidth = "max-w-3xl",
  headerActions,
  footer,
  bodyClass,
  docked = false,
  children,
}: SheetShellProps) {
  // Press-origin-aware dismissal: close only if BOTH the mousedown and the
  // click landed on the scrim itself. A plain onClick={onClose} on the scrim
  // (relying on stopPropagation inside) breaks when a click inside the sheet
  // changes its height — e.g. a Tabs switch that shortens the body reflows
  // the vertically-centered scrim between mousedown and click, so the click
  // coordinate ends up over the (now-repositioned) scrim even though the
  // press started on real content, closing the sheet out from under it.
  const scrimPressedRef = useRef(false);
  // Escape closes, matching Dialog. On the document rather than the sheet so it
  // fires before anything inside has taken focus. Modal only: a docked panel is
  // part of the workspace, and Escape there belongs to whatever field has
  // focus, not to the panel.
  useEffect(() => {
    if (docked) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, docked]);

  const header = (
    <div
      className={`flex items-center justify-between border-b border-border-subtle ${
        docked ? "px-3 py-2" : "px-5 py-3"
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <h2 className={`m-0 truncate text-text-primary ${docked ? "fs-sectionTitle" : "fs-pageTitle"}`}>
            {title}
          </h2>
          {inlineMeta && <span className="fs-data truncate text-text-tertiary">{inlineMeta}</span>}
        </div>
        {subtitle && <p className="fs-caption m-0 mt-0.5 truncate text-text-secondary">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {headerActions}
        <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
      </div>
    </div>
  );

  const body = <div className={bodyClass ?? (docked ? DOCKED_BODY_CLASS : DEFAULT_BODY_CLASS)}>{children}</div>;
  const foot = footer ? (
    <div className={`border-t border-border-subtle ${docked ? "px-3 py-2" : "px-5 py-3"}`}>
      {footer}
    </div>
  ) : null;

  // Docked: no scrim, no elevation, no radius — the panel's separation comes
  // from the workspace border it sits against, not from floating above it.
  if (docked) {
    return (
      <div aria-label={title} className="flex min-h-0 flex-1 flex-col">
        {header}
        {body}
        {foot}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fs-fade-in items-center justify-center bg-surface-scrim p-4"
      onMouseDown={(e) => {
        scrimPressedRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (scrimPressedRef.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[85vh] w-full animate-fs-pop-in flex-col rounded-4 border border-border-default bg-surface-raised shadow-elev-3 ${maxWidth}`}
        onClick={(e) => e.stopPropagation()}
      >
        {header}
        {body}
        {foot}
      </div>
    </div>
  );
}
