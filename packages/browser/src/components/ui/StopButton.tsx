import { Stop } from "@phosphor-icons/react";
import { Icon } from "./Icon";

// The stop half of the app's run/stop pair. Error-outlined (never filled red,
// per Button's destructive doctrine), with the cooperative-stop tooltip baked
// in so the semantics read identically everywhere it appears.
export interface StopButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md";
  /** Tooltip override; the default states the cooperative-stop contract. */
  label?: string;
}

const SIZES = {
  sm: { box: "size-6", icon: 14 },
  md: { box: "size-7", icon: 16 },
};

export function StopButton({
  size = "md",
  label = "Stop. Any in-flight LLM call still completes; finished conversations are kept.",
  className,
  type = "button",
  ...rest
}: StopButtonProps) {
  return (
    <button
      type={type}
      aria-label="Stop"
      title={label}
      className={`inline-flex items-center justify-center rounded-2 border border-state-error-line bg-state-error-bg text-state-error-fg transition-[background-color] duration-[90ms] ease-standard hover:bg-state-error-bg-hover ${SIZES[size].box}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      <Icon icon={Stop} size={SIZES[size].icon} />
    </button>
  );
}
