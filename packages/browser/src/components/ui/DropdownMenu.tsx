import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
   * The control that opens the menu. Cloned with the open/close handler and the
   * menu ARIA attributes, so it must be a single element that forwards
   * `onClick`, `aria-expanded` and `aria-haspopup` — Button and IconButton do.
   */
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
  // Controlled-ness keys off whether `open` was passed, not whether a callback
  // was: a caller that wants to observe opens without owning the state passes
  // only `onOpenChange`, and keying off the callback left that menu permanently
  // closed because internal state was never written.
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const menu = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  const setOpen = useCallback(
    (v: boolean) => {
      if (!isControlled) setOpenState(v);
      onOpenChange?.(v);
    },
    [isControlled, onOpenChange],
  );

  const rows = useCallback(
    () => Array.from(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []),
    [],
  );

  // Opening with the keyboard should land on the first row; opening with the
  // mouse should not steal the pointer's target. Focusing on open covers both:
  // a mouse user's next action is a click, which moves focus anyway.
  useEffect(() => {
    if (open) rows()[0]?.focus();
  }, [open, rows]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const items = rows();
      const i = items.indexOf(document.activeElement as HTMLElement);
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setOpen(false);
          // Hand focus back to the trigger, or Escape strands the keyboard user
          // at the top of the document.
          wrapper.current?.querySelector("button")?.focus();
          break;
        case "ArrowDown":
          e.preventDefault();
          items[(i + 1) % items.length]?.focus();
          break;
        case "ArrowUp":
          e.preventDefault();
          items[(i - 1 + items.length) % items.length]?.focus();
          break;
        case "Home":
          e.preventDefault();
          items[0]?.focus();
          break;
        case "End":
          e.preventDefault();
          items[items.length - 1]?.focus();
          break;
        case "Tab":
          // Tabbing away is a dismissal, not a way to walk out of an open menu.
          setOpen(false);
          break;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, rows, setOpen]);

  return (
    <div
      ref={wrapper}
      className={`relative inline-flex${className ? ` ${className}` : ""}`}
    >
      {isValidElement<{
        onClick?: (e: React.MouseEvent) => void;
        "aria-expanded"?: boolean;
        "aria-haspopup"?: "menu";
      }>(trigger)
        ? cloneElement(trigger, {
            onClick: (e: React.MouseEvent) => {
              trigger.props.onClick?.(e);
              setOpen(!open);
            },
            "aria-expanded": open,
            "aria-haspopup": "menu",
          })
        : trigger}
      {open && (
        <>
          {/* Full-viewport click catcher: closes on any outside click without a
              document listener that would also have to be torn down. */}
          <div className="fixed inset-0 z-70" onClick={() => setOpen(false)} />
          <div
            ref={menu}
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
            ? "cursor-pointer text-state-error-fg hover:bg-state-error-bg focus:bg-state-error-bg"
            : "cursor-pointer text-text-primary hover:bg-surface-hover focus:bg-surface-hover",
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
