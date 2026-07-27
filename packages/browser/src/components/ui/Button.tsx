import { forwardRef } from "react";
import { SpinnerGap } from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icon } from "./Icon";

// Labels are verb + object, sentence case, 3 words max: "Run test", "Publish
// agent", "Add condition". Never "Submit", "OK", "Learn more".
export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const SIZES: Record<ButtonSize, { box: string; icon: number }> = {
  sm: { box: "h-6 min-w-6 px-2 gap-[5px] text-12", icon: 14 }, // inline in rows
  md: { box: "h-7 min-w-7 px-2.5 gap-1.5 text-13", icon: 16 }, // default chrome
  lg: { box: "h-8 min-w-8 px-3 gap-1.5 text-13", icon: 16 }, // dialog footers
};

// Press is a 1px downward translate, never a scale — scaling 13px text on a
// dense canvas makes it shimmer. Emphasis goes to pure black / pure white.
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-emphasis text-emphasis-fg border-transparent hover:bg-emphasis-hover active:bg-emphasis-hover",
  secondary:
    "bg-surface-panel text-text-primary border-border-default hover:bg-surface-hover hover:border-border-strong active:bg-surface-active",
  ghost:
    "bg-transparent text-text-secondary border-transparent hover:bg-surface-hover active:bg-surface-active",
  // Destructive is outlined, never filled red: a filled red button in a builder
  // reads as an error state rather than an action.
  destructive:
    "bg-transparent text-state-error-fg border-border-default hover:bg-state-error-bg hover:border-state-error-line active:bg-state-error-bg active:border-state-error-line",
};

const DISABLED: Record<ButtonVariant, string> = {
  primary: "bg-state-disabled-bg text-text-disabled border-state-disabled-line",
  secondary: "bg-transparent text-text-disabled border-state-disabled-line",
  ghost: "bg-transparent text-text-disabled border-transparent",
  destructive: "bg-transparent text-text-disabled border-state-disabled-line",
};

// Extends the native button attributes and spreads the rest through, so
// composition wrappers (Radix `asChild` triggers, tooltips) can inject their
// handlers and ARIA without this file having to know each one.
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading glyph, e.g. `import { Play } from "@phosphor-icons/react"`. */
  icon?: PhosphorIcon;
  /** Trailing glyph. Use only for disclosure / overflow affordances. */
  iconRight?: PhosphorIcon;
  /** Swaps the leading glyph for a spinner and blocks interaction. */
  loading?: boolean;
  fullWidth?: boolean;
}

/** Text button. One primary per view. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    icon,
    iconRight,
    disabled,
    loading,
    fullWidth,
    children,
    type = "button",
    className,
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
      disabled={inert}
      {...rest}
      className={[
        "inline-flex items-center justify-center whitespace-nowrap rounded-2 border font-medium tracking-snug",
        "transition-[background-color,border-color,color,transform] duration-[90ms] ease-standard",
        s.box,
        inert ? DISABLED[variant] : VARIANTS[variant],
        inert ? "cursor-not-allowed" : "cursor-pointer active:translate-y-px",
        fullWidth ? "w-full" : "",
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
      ) : icon ? (
        <Icon icon={icon} size={s.icon} />
      ) : null}
      {children}
      {iconRight ? <Icon icon={iconRight} weight="bold" size={12} /> : null}
    </button>
  );
});
