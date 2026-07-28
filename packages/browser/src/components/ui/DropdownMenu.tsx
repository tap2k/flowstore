import { isValidElement, type ReactNode } from "react";
import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";

export interface MenuItemSpec {
  label?: string;
  icon?: PhosphorIcon;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  tone?: "default" | "destructive";
  onSelect?: () => void;
  /** Renders a 1px divider instead of a row. */
  separator?: boolean;
  /** Renders an uppercase 11px group header instead of a row. */
  header?: string;
}

export interface DropdownMenuProps {
  /**
   * The control that opens the menu. Must be a single element that forwards a
   * ref and spreads unknown props onto its root (Button and IconButton do) —
   * the Radix trigger injects its open/close handlers and ARIA through it.
   */
  trigger: ReactNode;
  items: MenuItemSpec[];
  align?: "left" | "right";
  /** Controlled open state. Omit to let the menu manage its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * Level-2 dropdown. Rows are 28px, sentence case, shortcuts right-aligned.
 *
 * Behavior comes from the Radix DropdownMenu primitive — keyboard navigation,
 * Escape with focus return, outside-click dismissal, typeahead, and the ARIA
 * menu contract. This file owns only the row vocabulary and the visual layer.
 */
export function DropdownMenu({
  trigger,
  items = [],
  align = "left",
  open,
  onOpenChange,
  className,
}: DropdownMenuProps) {
  return (
    <RadixMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <RadixMenu.Trigger asChild className={className}>
        {isValidElement(trigger) ? trigger : <span>{trigger}</span>}
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align={align === "left" ? "start" : "end"}
          sideOffset={4}
          // w-max lets the menu grow past min-w-46 to fit its widest row —
          // the bug this fixes was the row wrapping instead: a shrink-to-fit
          // box sizes off each flex child's own min-content unless that
          // child's text is pinned to one line (see MenuItem's
          // whitespace-nowrap), so a long label wrapped and blew out the
          // fixed h-7 row height rather than widening the menu.
          className="z-71 w-max min-w-46 max-w-72 animate-fs-pop-in rounded-4 border border-border-default bg-surface-raised p-1 shadow-elev-2"
        >
          {items.map((item, i) =>
            item.separator ? (
              <RadixMenu.Separator key={i} className="my-1 h-px bg-border-subtle" />
            ) : item.header ? (
              <RadixMenu.Label
                key={i}
                className="fs-micro px-2 pb-1 pt-1.5 uppercase tracking-caps text-text-disabled"
              >
                {item.header}
              </RadixMenu.Label>
            ) : (
              <MenuItem key={i} item={item} />
            ),
          )}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

function MenuItem({ item }: { item: MenuItemSpec }) {
  const danger = item.tone === "destructive";
  return (
    <RadixMenu.Item
      disabled={item.disabled}
      onSelect={() => item.onSelect?.()}
      className={[
        "fs-ui flex h-7 w-full select-none items-center gap-2 whitespace-nowrap rounded-2 border-none bg-transparent px-2 text-left outline-none",
        item.disabled
          ? "cursor-not-allowed text-text-disabled"
          : danger
            ? "cursor-pointer text-state-error-fg data-[highlighted]:bg-state-error-bg"
            : "cursor-pointer text-text-primary data-[highlighted]:bg-surface-hover",
      ].join(" ")}
    >
      {item.icon && (
        <Icon
          icon={item.icon}
          size={14}
          color={
            item.disabled
              ? "var(--text-disabled)"
              : danger
                ? "var(--state-error-fg)"
                : "var(--text-secondary)"
          }
        />
      )}
      <span className="flex-1">{item.label}</span>
      {item.checked && <Icon icon={Check} weight="bold" size={12} />}
      {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
    </RadixMenu.Item>
  );
}
