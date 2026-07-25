import { Check } from "@phosphor-icons/react";
import { Icon } from "./Icon";

export interface CheckboxProps {
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  /** Secondary line under the label, for a constraint or consequence. */
  hint?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
}

/**
 * Checkbox with label. Use for staged changes (applied on save); use Switch for
 * settings that take effect immediately.
 *
 * The native input stays in the DOM, visually hidden rather than replaced, so
 * focus, keyboard activation and form semantics are the browser's.
 */
export function Checkbox({
  checked,
  indeterminate,
  disabled,
  label,
  hint,
  onChange,
  className,
}: CheckboxProps) {
  const on = checked || indeterminate;
  return (
    <label
      className={[
        "group flex min-h-7 items-start gap-2 py-[5px]",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={onChange}
        readOnly={!onChange}
        className="sr-only"
      />
      <span
        aria-hidden
        className={[
          "mt-px flex size-4 flex-none items-center justify-center rounded-1 border",
          "transition-[background-color,border-color] duration-[90ms] ease-standard",
          disabled
            ? "border-state-disabled-line bg-state-disabled-bg"
            : on
              ? "border-emphasis bg-emphasis"
              : "border-border-default bg-surface-sunken group-hover:border-border-strong",
        ].join(" ")}
      >
        {/* Bold at 11px: Regular's stroke dissolves below 14px, and a check that
            doesn't read defeats the control. */}
        {indeterminate ? (
          <span className="h-[1.5px] w-2 bg-emphasis-fg" />
        ) : checked ? (
          <Icon icon={Check} weight="bold" size={11} color="var(--emphasis-fg)" />
        ) : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className={`fs-ui ${disabled ? "text-text-disabled" : "text-text-primary"}`}>
          {label}
        </span>
        {hint && <span className="fs-caption text-text-tertiary">{hint}</span>}
      </span>
    </label>
  );
}
