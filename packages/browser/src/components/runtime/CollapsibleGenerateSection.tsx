import { type ReactNode } from "react";

interface Props {
  title: string;
  countLabel: string;
  open: boolean;
  onToggle: () => void;
  onClear?: () => void;
  onGenerate?: () => void;
  apiKey?: string;
  disabled: boolean;
  generating: boolean;
  generateTitle: string;
  children: ReactNode;
}

// The Generate button is hidden unless an apiKey is provided.
export function CollapsibleGenerateSection({
  title,
  countLabel,
  open,
  onToggle,
  onClear,
  onGenerate,
  apiKey,
  disabled,
  generating,
  generateTitle,
  children,
}: Props) {
  return (
    <div className="border-b border-border-default bg-surface-sunken/50">
      <div className="flex items-center justify-between px-4 py-2 text-[11px] text-text-secondary">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center text-left hover:text-text-primary"
        >
          <span className="mr-1 text-text-tertiary">{open ? "▾" : "▸"}</span>
          {title}
          <span className="ml-1 text-text-tertiary">{countLabel}</span>
        </button>
        <div className="flex items-center gap-1">
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              disabled={disabled || generating}
              className="rounded border border-border-default bg-surface-panel px-2 py-0.5 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-40"
              title="Clear all filled values."
            >
              Clear
            </button>
          )}
          {apiKey && onGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={disabled || generating}
              className="rounded border border-border-default bg-surface-panel px-2 py-0.5 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-40"
              title={generateTitle}
            >
              {generating ? "Generating…" : "✨ Generate"}
            </button>
          )}
        </div>
      </div>
      {open && children}
    </div>
  );
}
