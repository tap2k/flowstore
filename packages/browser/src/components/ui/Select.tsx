import { CaretDown } from "@phosphor-icons/react";
import { Icon } from "./Icon";

export type SelectOption = string | { value: string; label: string };

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size" | "className" | "children"> {
  options?: SelectOption[];
  /** Render the value in data type — for model IDs, versions, numeric settings. */
  mono?: boolean;
  selectSize?: "md" | "lg";
  className?: string;
}

/**
 * Native select with Flowstore chrome. Native rather than a custom listbox: the
 * OS popup is keyboard- and screen-reader-correct for free, and this system has
 * no visual opinion about the open menu that would justify rebuilding it.
 */
export function Select({
  options = [],
  mono,
  selectSize = "md",
  disabled,
  className,
  ...rest
}: SelectProps) {
  return (
    <div
      className={[
        "relative inline-flex items-center rounded-2 border",
        "transition-[border-color,box-shadow] duration-[90ms] ease-standard",
        "focus-within:border-n-11 focus-within:shadow-[0_0_0_2px_var(--select-halo)]",
        selectSize === "lg" ? "h-8" : "h-7",
        disabled ? "bg-state-disabled-bg" : "bg-surface-panel hover:border-border-strong",
        "border-border-default",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <select
        disabled={disabled}
        className={[
          "h-full w-full appearance-none border-none bg-transparent pl-2 pr-[26px] outline-none",
          disabled ? "cursor-not-allowed text-text-disabled" : "cursor-pointer text-text-primary",
          mono ? "fs-data" : "fs-ui",
        ].join(" ")}
        {...rest}
      >
        {options.map((o) => {
          const value = typeof o === "string" ? o : o.value;
          const label = typeof o === "string" ? o : o.label;
          return (
            <option key={value} value={value}>
              {label}
            </option>
          );
        })}
      </select>
      <Icon
        icon={CaretDown}
        weight="bold"
        size={12}
        color="var(--text-tertiary)"
        className="pointer-events-none absolute right-[7px]"
      />
    </div>
  );
}
