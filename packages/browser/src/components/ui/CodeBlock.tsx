export interface CodeBlockProps {
  code?: string;
  /** Right-aligned tabular gutter in --text-disabled. */
  lineNumbers?: boolean;
  maxHeight?: number | string;
  /** Uppercase 11px caption strip, e.g. "REQUEST BODY". */
  label?: string;
  className?: string;
}

/**
 * Multi-line machine text on a sunken surface.
 *
 * There is no second typeface: `.fs-code` is Geist at 13/20 with +0.008em
 * tracking, tabular figures, and ligatures plus contextual alternates disabled
 * so `!=`, `=>` and `--` never fuse into a single glyph.
 */
export function CodeBlock({ code = "", lineNumbers, maxHeight, label, className }: CodeBlockProps) {
  // Drop one trailing newline so a template literal doesn't render a phantom
  // final line (and, with lineNumbers, a phantom number beside it).
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div
      className={[
        "overflow-hidden rounded-3 border border-border-subtle bg-surface-sunken",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label && (
        <div className="fs-micro flex h-6 items-center border-b border-border-subtle px-2.5 uppercase text-text-disabled">
          {label}
        </div>
      )}
      <pre
        className="fs-code m-0 flex gap-2.5 overflow-auto px-3 py-2 text-text-primary"
        style={{ maxHeight }}
      >
        {lineNumbers && (
          <span aria-hidden className="flex-none select-none text-right text-text-disabled tabular">
            {lines.map((_, i) => (
              <span key={i} className="block">
                {i + 1}
              </span>
            ))}
          </span>
        )}
        <code className="min-w-0 flex-1 whitespace-pre">{lines.join("\n")}</code>
      </pre>
    </div>
  );
}
