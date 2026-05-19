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
    <div className="border-b border-zinc-200 bg-zinc-50/50">
      <div className="flex items-center justify-between px-4 py-2 text-[11px] text-zinc-600">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center text-left hover:text-zinc-900"
        >
          <span className="mr-1 text-zinc-400">{open ? "▾" : "▸"}</span>
          {title}
          <span className="ml-1 text-zinc-400">{countLabel}</span>
        </button>
        <div className="flex items-center gap-1">
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              disabled={disabled || generating}
              className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
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
              className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
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
