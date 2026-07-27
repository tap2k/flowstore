import { forwardRef } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icon, type IconWeight } from "./Icon";
import type { MenuTriggerProps } from "./DropdownMenu";

export type IconButtonSize = "sm" | "md" | "lg" | "canvas";

const SIZES: Record<IconButtonSize, { box: string; icon: number }> = {
  sm: { box: "size-6", icon: 14 },
  md: { box: "size-7", icon: 16 }, // default
  lg: { box: "size-8", icon: 16 },
  // 36px floating canvas controls sit over a moving graph and need the larger
  // hit target (--hit-canvas); their glyph steps up to 20 to match.
  canvas: { box: "size-9", icon: 20 },
};

export interface IconButtonProps extends MenuTriggerProps {
  icon: PhosphorIcon;
  size?: IconButtonSize;
  /** Toggled-on state: selected fill + bold glyph (a second signal besides colour). */
  active?: boolean;
  disabled?: boolean;
  /** Required — serves as both the tooltip and the accessible name. */
  label: string;
  /** Leave unset. The component picks regular, or bold when `active`. */
  weight?: IconWeight;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
}

/**
 * Square icon-only control. The border appears only on hover so idle chrome
 * stays quiet — no control may outweigh an idle node border.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    size = "md",
    active,
    disabled,
    label,
    weight,
    onClick,
    className,
    "aria-expanded": ariaExpanded,
    "aria-haspopup": ariaHasPopup,
  },
  ref,
) {
  const s = SIZES[size];
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        "inline-flex items-center justify-center rounded-2 border",
        "transition-[background-color,border-color,color] duration-[90ms] ease-standard",
        s.box,
        disabled
          ? "cursor-not-allowed border-transparent bg-transparent text-text-disabled"
          : active
            ? "cursor-pointer border-border-default bg-surface-selected text-text-primary active:bg-surface-active"
            : "cursor-pointer border-transparent bg-transparent text-text-secondary hover:border-border-default hover:bg-surface-hover active:bg-surface-active",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon icon={icon} weight={weight ?? (active ? "bold" : "regular")} size={s.icon} />
    </button>
  );
});
