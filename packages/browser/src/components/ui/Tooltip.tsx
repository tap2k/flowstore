import { isValidElement, type ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { Kbd } from "./Kbd";

export type TooltipSide = "top" | "bottom" | "left" | "right";

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
 *
 * Behavior comes from the Radix Tooltip primitive — open/close timing,
 * positioning, and the trigger's aria-describedby wiring. This file owns
 * only the visual layer.
 */
export function Tooltip({
  label,
  shortcut,
  side = "top",
  delay = 200,
  children,
  className,
}: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={delay}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>
          {/* The span keeps the trigger contract loose: children need not
              forward refs or spread props themselves. */}
          <span className={`inline-flex${className ? ` ${className}` : ""}`}>
            {isValidElement(children) ? children : <span>{children}</span>}
          </span>
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            className="fs-caption z-60 flex animate-fs-pop-in items-center gap-1.5 whitespace-nowrap rounded-2 border border-border-default bg-surface-raised px-[7px] py-1 text-text-primary shadow-elev-2"
          >
            {label}
            {shortcut && <Kbd>{shortcut}</Kbd>}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
