import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Kbd } from "./Kbd";

export type TooltipSide = "top" | "bottom" | "left" | "right";

const SIDE: Record<TooltipSide, string> = {
  top: "bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2",
  bottom: "top-[calc(100%+6px)] left-1/2 -translate-x-1/2",
  left: "right-[calc(100%+6px)] top-1/2 -translate-y-1/2",
  right: "left-[calc(100%+6px)] top-1/2 -translate-y-1/2",
};

export interface TooltipProps {
  /** Noun phrase or imperative. No article, no full stop. */
  label: string;
  /** e.g. "Cmd+K" — split into Kbd chips on the right. */
  shortcut?: string;
  side?: TooltipSide;
  /** ms before showing. 200 default; 0 for canvas controls. */
  delay?: number;
  children?: ReactNode;
  className?: string;
}

/**
 * Level-2 tooltip on hover or focus.
 *
 * A tooltip never repeats a visible label — it adds the shortcut or the
 * constraint. If all it would say is what the button already says, drop it.
 */
export function Tooltip({
  label,
  shortcut,
  side = "top",
  delay = 200,
  children,
  className,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  // A ref, not a local: a local timer id is re-created every render, so the
  // clearTimeout on mouseleave would be clearing a stale handle and the tooltip
  // could still appear after the pointer left.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = () => {
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span
      className={`relative inline-flex${className ? ` ${className}` : ""}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={() => setOpen(true)}
      onBlur={hide}
    >
      {/* aria-describedby only while shown: pointing at an element that isn't in
          the DOM leaves a dangling reference, and the tooltip is what supplies
          the description, not the trigger. */}
      {isValidElement<{ "aria-describedby"?: string }>(children) && open
        ? cloneElement(children, {
            // Merged, not clobbered: a FieldRow-wrapped trigger already carries
            // a describedby pointing at its hint.
            "aria-describedby": [children.props["aria-describedby"], id]
              .filter(Boolean)
              .join(" "),
          })
        : children}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`fs-caption pointer-events-none absolute z-60 flex animate-fs-pop-in items-center gap-1.5 whitespace-nowrap rounded-2 border border-border-default bg-surface-raised px-[7px] py-1 text-text-primary shadow-elev-2 ${SIDE[side]}`}
        >
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </span>
      )}
    </span>
  );
}
