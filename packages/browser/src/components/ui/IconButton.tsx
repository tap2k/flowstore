import { forwardRef } from "react";
import { SpinnerGap } from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icon, type IconWeight } from "./Icon";

export type IconButtonSize = "sm" | "md" | "lg" | "canvas";
export type IconButtonVariant = "ghost" | "primary";

const SIZES: Record<IconButtonSize, { box: string; icon: number }> = {
  sm: { box: "size-6", icon: 14 },
  md: { box: "size-7", icon: 16 }, // default
  lg: { box: "size-8", icon: 16 },
  // 36px floating canvas controls sit over a moving graph and need the larger
  // hit target (--hit-canvas); their glyph steps up to 20 to match.
  canvas: { box: "size-9", icon: 20 },
};

// Extends the native button attributes and spreads the rest through, so
// composition wrappers (Radix `asChild` triggers, tooltips) can inject their
// handlers and ARIA without this file having to know each one.
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: PhosphorIcon;
  size?: IconButtonSize;
  /** "ghost" (default) is quiet chrome; "primary" is the emphasis fill — one per view. */
  variant?: IconButtonVariant;
  /** Toggled-on state: selected fill + bold glyph (a second signal besides colour). */
  active?: boolean;
  /** Swaps the glyph for a spinner and blocks interaction (mirrors Button). */
  loading?: boolean;
  /** Required — serves as both the tooltip and the accessible name. */
  label: string;
  /** Leave unset. The component picks regular, or bold when `active`. */
  weight?: IconWeight;
}

/**
 * Square icon-only control. The border appears only on hover so idle chrome
 * stays quiet — no control may outweigh an idle node border.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    size = "md",
    variant = "ghost",
    active,
    disabled,
    loading,
    label,
    weight,
    className,
    type = "button",
    ...rest
  },
  ref,
) {
  const s = SIZES[size];
  const inert = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={inert}
      {...rest}
      className={[
        "inline-flex items-center justify-center rounded-2 border",
        "transition-[background-color,border-color,color] duration-[90ms] ease-standard",
        s.box,
        inert
          ? variant === "primary"
            ? "cursor-not-allowed border-state-disabled-line bg-state-disabled-bg text-text-disabled"
            : "cursor-not-allowed border-transparent bg-transparent text-text-disabled"
          : variant === "primary"
            ? "cursor-pointer border-transparent bg-emphasis text-emphasis-fg hover:bg-emphasis-hover active:bg-emphasis-hover"
            : active
              ? "cursor-pointer border-border-default bg-surface-selected text-text-primary active:bg-surface-active"
              : "cursor-pointer border-transparent bg-transparent text-text-secondary hover:border-border-default hover:bg-surface-hover active:bg-surface-active",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {loading ? (
        <Icon
          icon={SpinnerGap}
          weight="bold"
          size={s.icon}
          className="animate-fs-spin motion-reduce:animate-none"
        />
      ) : (
        <Icon icon={icon} weight={weight ?? (active ? "bold" : "regular")} size={s.icon} />
      )}
    </button>
  );
});
