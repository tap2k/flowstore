import type { ReactNode } from "react";
import { Info } from "@phosphor-icons/react";
import { Icon } from "./Icon";

export interface FieldRowProps {
  label: string;
  /** Caption under the control. */
  hint?: string;
  /** Tooltip text on an info glyph beside the label. */
  help?: string;
  required?: boolean;
  /** Replaces `hint` and turns it error-coloured. */
  error?: string;
  children?: ReactNode;
  /** Compact label-left layout, for switches and small numerics. */
  inline?: boolean;
  className?: string;
}

/** One labelled field in an inspector. Stacked by default. */
export function FieldRow({
  label,
  hint,
  help,
  required,
  error,
  children,
  inline,
  className,
}: FieldRowProps) {
  return (
    <div
      className={[
        "flex py-1.5",
        inline ? "flex-row items-center justify-between gap-3" : "flex-col items-stretch gap-1.5",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={`flex items-center gap-[5px]${inline ? " min-w-0" : ""}`}>
        <span className="fs-label text-text-secondary">{label}</span>
        {/* "required" as a word, not an asterisk: an asterisk is a convention
            the reader has to already know. */}
        {required && <span className="fs-caption text-text-disabled">required</span>}
        {help && <Icon icon={Info} size={12} color="var(--text-disabled)" title={help} />}
      </div>
      <div className={inline ? "flex-none" : undefined}>{children}</div>
      {(hint || error) && (
        <span className={`fs-caption ${error ? "text-state-error-fg" : "text-text-tertiary"}`}>
          {error || hint}
        </span>
      )}
    </div>
  );
}
