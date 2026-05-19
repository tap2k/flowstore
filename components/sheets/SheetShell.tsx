import type { ReactNode } from "react";

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
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-lg shadow-lg w-full ${maxWidth} max-h-[85vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
              {inlineMeta && (
                <span className="text-xs text-zinc-400 font-mono">{inlineMeta}</span>
              )}
            </div>
            {subtitle && <p className="text-xs text-zinc-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {headerActions}
            <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-900">
              close
            </button>
          </div>
        </div>
        <div className={bodyClass}>{children}</div>
        {footer && <div className="border-t border-zinc-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
