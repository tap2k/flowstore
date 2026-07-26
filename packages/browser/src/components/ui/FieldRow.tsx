import { cloneElement, isValidElement, useId, type ReactNode } from "react";
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
  const controlId = useId();
  const describedById = `${controlId}-desc`;
  const description = error || hint;

  // Wire the label and the hint/error to the control. The child is given an
  // `id` only if it doesn't already carry one, so a caller that manages its own
  // ids keeps them. Clicking the label then focuses the control, and the hint is
  // announced with it rather than being loose text nearby.
  const control =
    isValidElement<{ id?: string; "aria-describedby"?: string }>(children) ? (
      cloneElement(children, {
        id: children.props.id ?? controlId,
        "aria-describedby": description
          ? [children.props["aria-describedby"], describedById].filter(Boolean).join(" ")
          : children.props["aria-describedby"],
      })
    ) : (
      children
    );

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
        {/* Only a real <label> when there is a control to point at. A `htmlFor`
            aimed at an id that was never applied is worse than a plain span:
            it reads as an association that doesn't exist. */}
        {isValidElement(children) ? (
          <label htmlFor={controlId} className="fs-label text-text-secondary">
            {label}
          </label>
        ) : (
          <span className="fs-label text-text-secondary">{label}</span>
        )}
        {/* "required" as a word, not an asterisk: an asterisk is a convention
            the reader has to already know. */}
        {required && <span className="fs-caption text-text-disabled">required</span>}
        {help && <Icon icon={Info} size={12} color="var(--text-disabled)" title={help} />}
      </div>
      <div className={inline ? "flex-none" : undefined}>{control}</div>
      {description && (
        <span
          id={describedById}
          className={`fs-caption ${error ? "text-state-error-fg" : "text-text-tertiary"}`}
        >
          {description}
        </span>
      )}
    </div>
  );
}
