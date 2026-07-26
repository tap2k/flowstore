import { forwardRef } from "react";

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  /**
   * Switch to code typography for prompts and JSON: +tracking, tabular figures,
   * ligatures and contextual alternates OFF so `!=`, `=>` and `--` never fuse.
   * Also disables spellcheck — red squiggles under every identifier are noise.
   */
  code?: boolean;
  invalid?: boolean;
  className?: string;
}

/** Multi-line input on a sunken surface. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { code, invalid, disabled, rows = 4, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      disabled={disabled}
      spellCheck={!code}
      aria-invalid={invalid || undefined}
      className={[
        "w-full resize-y rounded-3 border px-2.5 py-2 outline-none",
        "transition-[border-color,box-shadow] duration-[90ms] ease-standard",
        "focus:shadow-[0_0_0_2px_var(--select-halo)]",
        disabled ? "bg-state-disabled-bg text-text-disabled" : "bg-surface-sunken text-text-primary",
        invalid ? "border-state-error-line" : "border-border-default focus:border-n-11",
        // fs-code sets white-space:pre, which would stop a prose textarea from
        // wrapping; the code variant wants exactly that.
        code ? "fs-code" : "fs-ui",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
});
