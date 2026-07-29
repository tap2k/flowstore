import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icon } from "./Icon";

// Shared shell of the app's run/stop pair: tinted container, never a solid
// fill. One component so the two halves cannot drift (they did: RunButton
// once had a disabled style StopButton lacked).
export interface TransportButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md";
  label: string;
}

const SIZES = {
  sm: { box: "size-6", icon: 14 },
  md: { box: "size-7", icon: 16 },
};

const TONES = {
  run: "border-state-success-line bg-state-success-bg text-state-success-fg hover:bg-state-success-bg-hover",
  stop: "border-state-error-line bg-state-error-bg text-state-error-fg hover:bg-state-error-bg-hover",
};

export function TransportButton({
  tone,
  icon,
  size = "md",
  label,
  className,
  type = "button",
  ...rest
}: TransportButtonProps & { tone: keyof typeof TONES; icon: PhosphorIcon }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-2 border transition-[background-color] duration-[90ms] ease-standard disabled:opacity-40 ${TONES[tone]} ${SIZES[size].box}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      <Icon icon={icon} size={SIZES[size].icon} />
    </button>
  );
}
