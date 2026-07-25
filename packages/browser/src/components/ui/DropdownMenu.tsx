import { useState, type ReactNode } from "react";
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
  trigger: ReactNode;
  items: MenuItemSpec[];
  align?: "left" | "right";
  /** Controlled open state. Omit to let the menu manage its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** Level-2 dropdown. Rows are 28px, sentence case, shortcuts right-aligned. */
export function DropdownMenu({
  trigger,
  items = [],
  align = "left",
  open: openProp,
  onOpenChange,
  className,
}: DropdownMenuProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setOpenState(v));

  return (
    <div className={`relative inline-flex${className ? ` ${className}` : ""}`}>
      <span onClick={() => setOpen(!open)}>{trigger}</span>
      {open && (
        <>
          {/* Full-viewport click catcher: closes on any outside click without a
              document listener that would also have to be torn down. */}
          <div className="fixed inset-0 z-70" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className={`absolute top-[calc(100%+4px)] z-71 min-w-46 animate-fs-pop-in rounded-4 border border-border-default bg-surface-raised p-1 shadow-elev-2 ${
              align === "left" ? "left-0" : "right-0"
            }`}
          >
            {items.map((item, i) =>
              item.separator ? (
                <div key={i} className="my-1 h-px bg-border-subtle" />
              ) : item.header ? (
                <div
                  key={i}
                  className="fs-micro px-2 pb-1 pt-1.5 uppercase tracking-caps text-text-disabled"
                >
                  {item.header}
                </div>
              ) : (
                <MenuItem
                  key={i}
                  item={item}
                  onSelect={() => {
                    if (item.disabled) return;
                    item.onSelect?.();
                    setOpen(false);
                  }}
                />
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ item, onSelect }: { item: MenuItemSpec; onSelect: () => void }) {
  const danger = item.tone === "destructive";
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onClick={onSelect}
      className={[
        "fs-ui flex h-7 w-full items-center gap-2 rounded-2 border-none bg-transparent px-2 text-left",
        item.disabled
          ? "cursor-not-allowed text-text-disabled"
          : danger
            ? "cursor-pointer text-state-error-fg hover:bg-state-error-bg"
            : "cursor-pointer text-text-primary hover:bg-surface-hover",
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
    </button>
  );
}
