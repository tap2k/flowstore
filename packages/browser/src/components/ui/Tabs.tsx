import * as RadixTabs from "@radix-ui/react-tabs";
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
 *
 * Behavior comes from the Radix Tabs primitive — roving tabindex, arrow-key
 * navigation with selection following focus, Home/End. This file owns only
 * the visual layer.
 */
export function Tabs({ items = [], value, onChange, className }: TabsProps) {
  return (
    <RadixTabs.Root value={value ?? ""} onValueChange={onChange}>
      <RadixTabs.List
        className={`flex gap-0.5 border-b border-border-subtle${className ? ` ${className}` : ""}`}
      >
        {items.map((item) => {
          const id = typeof item === "string" ? item : item.value;
          const label = typeof item === "string" ? item : item.label;
          const on = id === value;
          return (
            <RadixTabs.Trigger
              key={id}
              value={id}
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
            </RadixTabs.Trigger>
          );
        })}
      </RadixTabs.List>
    </RadixTabs.Root>
  );
}
