import { CaretRight } from "@phosphor-icons/react";
import { Icon } from "./Icon";

// The one disclosure arrow. Every expand/collapse row and section header
// renders this instead of a hand-placed ▸/▾ glyph span, so the affordance has
// one size and tone everywhere. 12px bold per Icon.tsx's micro-glyph rule;
// rotates in place. Decorative — the wrapping button carries the label.
export function DisclosureCaret({ open, className }: { open: boolean; className?: string }) {
  return (
    <Icon
      icon={CaretRight}
      size={12}
      weight="bold"
      className={`shrink-0 text-text-tertiary transition-transform duration-[90ms] ease-standard ${
        open ? "rotate-90" : ""
      }${className ? ` ${className}` : ""}`}
    />
  );
}
