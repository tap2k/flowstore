import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icon } from "./Icon";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "className"> {
  /** Leading glyph, rendered regular 14 in tertiary text. */
  icon?: PhosphorIcon;
  /** Trailing unit, set in data type — e.g. "ms", "tokens". */
  suffix?: string;
  /**
   * Data typography for the value: 12px / 500 / +0.008em / tabular figures.
   * Set this for any numeric, ID, variable name or JSON-ish value — anything
   * where a digit can change in place or align down a column.
   */
  mono?: boolean;
  invalid?: boolean;
  inputSize?: "md" | "lg";
  className?: string;
}

/**
 * Recessed text input: sunken fill + 1px border, no inner shadow. A recessed
 * input in this system is a surface step, not a shadow.
 */
export function Input({
  icon,
  suffix,
  mono,
  invalid,
  inputSize = "md",
  disabled,
  className,
  ...rest
}: InputProps) {
  return (
    <div
      className={[
        "flex items-center gap-1.5 rounded-2 border px-2",
        "transition-[border-color,box-shadow] duration-[90ms] ease-standard",
        "focus-within:shadow-[0_0_0_2px_var(--select-halo)]",
        inputSize === "lg" ? "h-8" : "h-7",
        disabled ? "bg-state-disabled-bg" : "bg-surface-sunken",
        invalid
          ? "border-state-error-line"
          : "border-border-default hover:border-border-strong focus-within:border-n-11",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon && <Icon icon={icon} size={14} color="var(--text-tertiary)" />}
      <input
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={[
          "min-w-0 flex-1 border-none bg-transparent outline-none",
          disabled ? "text-text-disabled" : "text-text-primary",
          mono ? "fs-data" : "fs-ui",
        ].join(" ")}
        {...rest}
      />
      {suffix && <span className="fs-caption tracking-data text-text-tertiary tabular">{suffix}</span>}
    </div>
  );
}
