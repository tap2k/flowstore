export interface KbdProps {
  /** A combo like "Cmd+K" splits into one chip per key. */
  children: string;
  className?: string;
}

/** Keyboard hint chip. Tabular so multi-key hints align down a menu column. */
export function Kbd({ children, className }: KbdProps) {
  const keys = children.split("+");
  return (
    <span className={`inline-flex items-center gap-0.5${className ? ` ${className}` : ""}`}>
      {keys.map((key, i) => (
        <kbd
          key={i}
          className="fs-micro inline-flex h-4 min-w-4 items-center justify-center rounded-1 border border-border-subtle bg-surface-sunken px-[3px] tracking-normal text-text-tertiary tabular"
        >
          {key.trim()}
        </kbd>
      ))}
    </span>
  );
}
