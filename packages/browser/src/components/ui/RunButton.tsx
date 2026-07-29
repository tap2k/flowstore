import { Play } from "@phosphor-icons/react";
import { Icon } from "./Icon";

// The run half of the app's run/stop pair — StopButton's mirror in success
// colors (tinted container, never a solid fill), so the pair reads as two
// states of one control wherever it appears.
export interface RunButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md";
  /** Tooltip; required so each surface states what "run" covers there. */
  label: string;
}

const SIZES = {
  sm: { box: "size-6", icon: 14 },
  md: { box: "size-7", icon: 16 },
};

export function RunButton({ size = "md", label, className, type = "button", ...rest }: RunButtonProps) {
  return (
    <button
      type={type}
      aria-label="Run"
      title={label}
      className={`inline-flex items-center justify-center rounded-2 border border-state-success-line bg-state-success-bg text-state-success-fg transition-[background-color] duration-[90ms] ease-standard hover:bg-state-success-bg-hover disabled:opacity-40 ${SIZES[size].box}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      <Icon icon={Play} size={SIZES[size].icon} />
    </button>
  );
}
