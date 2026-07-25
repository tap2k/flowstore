import type { ReactNode } from "react";

export interface PanelProps {
  /** Structural header — rendered UPPERCASE 12/560/+0.06em, never for emphasis. */
  title?: string;
  /** Right-aligned header controls, normally IconButtons. */
  actions?: ReactNode;
  children?: ReactNode;
  /** Drop body padding, for lists and tables that own their own row padding. */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
}

/**
 * Level-1 surface: panel fill + 1px border + --elev-1.
 *
 * This is for grouping that must be *dragged, selected or executed* as a unit.
 * Plain visual grouping is a divider and a panel header, not a box — there are
 * no decorative cards in this system, and cards inside cards are never right.
 */
export function Panel({
  title,
  actions,
  children,
  flush,
  className,
  bodyClassName,
}: PanelProps) {
  return (
    <section
      className={[
        "flex min-h-0 flex-col overflow-hidden rounded-3 border border-border-default bg-surface-panel shadow-elev-1",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {title && (
        <header className="flex h-8 flex-none items-center justify-between gap-2 border-b border-border-subtle px-3">
          <span className="fs-panelHeader text-text-tertiary">{title}</span>
          {actions && <span className="flex items-center gap-0.5">{actions}</span>}
        </header>
      )}
      <div
        className={[
          "min-h-0 flex-1 overflow-auto",
          flush ? "" : "p-3",
          bodyClassName ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
    </section>
  );
}
