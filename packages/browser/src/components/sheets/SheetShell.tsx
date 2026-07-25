import { useEffect, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui";

interface SheetShellProps {
  title: string;
  inlineMeta?: ReactNode;
  subtitle?: string;
  onClose: () => void;
  maxWidth?: string;
  headerActions?: ReactNode;
  footer?: ReactNode;
  bodyClass?: string;
  children: ReactNode;
}

const DEFAULT_BODY_CLASS = "flex-1 overflow-auto px-5 py-4 space-y-6";

/**
 * Level-3 modal shell shared by every spec sheet. Built on the design system's
 * surfaces and elevation rather than the Dialog atom: sheets are editors with
 * their own scroll region, header actions and footer, where Dialog is sized for
 * a decision.
 */
export function SheetShell({
  title,
  inlineMeta,
  subtitle,
  onClose,
  maxWidth = "max-w-3xl",
  headerActions,
  footer,
  bodyClass = DEFAULT_BODY_CLASS,
  children,
}: SheetShellProps) {
  // Escape closes, matching Dialog. On the document rather than the sheet so it
  // fires before anything inside has taken focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fs-fade-in items-center justify-center bg-surface-scrim p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[85vh] w-full animate-fs-pop-in flex-col rounded-4 border border-border-default bg-surface-raised shadow-elev-3 ${maxWidth}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="fs-pageTitle m-0 text-text-primary">{title}</h2>
              {inlineMeta && <span className="fs-data text-text-tertiary">{inlineMeta}</span>}
            </div>
            {subtitle && (
              <p className="fs-caption m-0 mt-0.5 truncate text-text-secondary">{subtitle}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
          </div>
        </div>
        <div className={bodyClass}>{children}</div>
        {footer && <div className="border-t border-border-subtle px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
