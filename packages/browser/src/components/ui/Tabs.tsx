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
  const values = items.map((item) => (typeof item === "string" ? item : item.value));

  // The ARIA tab pattern: arrows move between tabs (wrapping), Home/End jump to
  // the ends, and only the selected tab is in the page's tab order — Tab enters
  // and leaves the set rather than walking through every tab in it.
  function onKeyDown(e: React.KeyboardEvent) {
    if (values.length === 0) return;
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    let next: number;
    if (delta !== 0) {
      next = (values.indexOf(value ?? "") + delta + values.length) % values.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = values.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    onChange?.(values[next]);
    // Selection follows focus in this pattern, so move focus with it. The tab
    // buttons are the list's only children, so the index addresses them exactly.
    (list.current?.children[next] as HTMLElement | undefined)?.focus();
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
