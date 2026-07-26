import { useRef } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icon } from "./Icon";

export type TabItem =
  | string
  | { value: string; label: string; icon?: PhosphorIcon; count?: number };

export interface TabsProps {
  items?: TabItem[];
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
}

/**
 * Underlined tabs for switching sections. The active rule is 2px and
 * achromatic — a tab is user intent, not machine state, so it must not borrow
 * the colour vocabulary that reports a run.
 */
export function Tabs({ items = [], value, onChange, className }: TabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const valueAt = (i: number) => {
    const item = items[i];
    return typeof item === "string" ? item : item?.value;
  };

  // The ARIA tab pattern: arrows move between tabs (wrapping), Home/End jump to
  // the ends, and only the selected tab is in the page's tab order — Tab enters
  // and leaves the set rather than walking through every tab in it.
  function onKeyDown(e: React.KeyboardEvent) {
    const delta =
      e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    let next: string | undefined;
    if (delta !== 0) {
      const i = items.findIndex((item) => (typeof item === "string" ? item : item.value) === value);
      next = valueAt((i + delta + items.length) % items.length);
    } else if (e.key === "Home") {
      next = valueAt(0);
    } else if (e.key === "End") {
      next = valueAt(items.length - 1);
    } else {
      return;
    }
    if (next === undefined) return;
    e.preventDefault();
    onChange?.(next);
    // Selection follows focus in this pattern, so move focus with it.
    list.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(next)}"]`)?.focus();
  }

  return (
    <div
      ref={list}
      role="tablist"
      onKeyDown={onKeyDown}
      className={`flex gap-0.5 border-b border-border-subtle${className ? ` ${className}` : ""}`}
    >
      {items.map((item) => {
        const id = typeof item === "string" ? item : item.value;
        const label = typeof item === "string" ? item : item.label;
        const on = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            data-tab={id}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange?.(id)}
            className={[
              // -mb-px pulls the 2px rule over the container's own hairline so
              // the two don't stack into a 3px edge.
              "-mb-px inline-flex h-8 cursor-pointer items-center gap-1.5 border-b-2 bg-transparent px-2.5 text-13 tracking-snug",
              "transition-colors duration-[140ms] ease-standard",
              on
                ? "border-emphasis font-medium text-text-primary"
                : "border-transparent font-book text-text-tertiary hover:text-text-secondary",
            ].join(" ")}
          >
            {typeof item !== "string" && item.icon && <Icon icon={item.icon} size={14} />}
            {label}
            {typeof item !== "string" && item.count != null && (
              <span className="fs-micro text-text-disabled tabular">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
