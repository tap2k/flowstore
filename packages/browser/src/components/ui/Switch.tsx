export interface SwitchProps {
  checked?: boolean;
  disabled?: boolean;
  label?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
}

/**
 * Binary switch for settings that take effect immediately. Use Checkbox for
 * changes that are staged until a save.
 */
export function Switch({ checked, disabled, label, onChange, className }: SwitchProps) {
  return (
    <label
      className={[
        "group inline-flex min-h-7 items-center gap-2",
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
          "relative h-4 w-7 flex-none rounded-full border",
          "transition-[background-color,border-color] duration-[90ms] ease-standard",
          disabled
            ? "border-state-disabled-line bg-state-disabled-bg"
            : checked
              ? "border-emphasis bg-emphasis"
              : "border-border-default bg-n-5 group-hover:border-border-strong",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 size-2.5 rounded-full shadow-elev-1",
            "transition-[left] duration-[90ms] ease-standard",
            checked ? "left-3.5 bg-emphasis-fg" : "left-0.5 bg-surface-panel",
          ].join(" ")}
        />
      </span>
      {label && (
        <span className={`fs-ui ${disabled ? "text-text-disabled" : "text-text-primary"}`}>
          {label}
        </span>
      )}
    </label>
  );
}
