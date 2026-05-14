import { useRef, type ChangeEvent, type ReactElement } from "react";

// Trigger a browser download of a CSV file. Used by every sheet that exports
// a CSV — keeps the blob/anchor/cleanup dance in one place.
export function downloadCsv(filename: string, csvText: string): void {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Hidden-file-input pattern shared by every CSV import button. Caller renders
// `input` somewhere (typically inside the same control group as their button)
// and wires `trigger` onto the visible button's onClick.
//
//   const { trigger, input } = useCsvFileInput(text => parseAndApply(text));
//   <button onClick={trigger}>import</button>
//   {input}
//
// Errors from `onText` (e.g. CSV parse failures) surface as an alert so
// callers don't each reinvent that boilerplate.
export function useCsvFileInput(
  onText: (text: string) => void | Promise<void>,
): { trigger: () => void; input: ReactElement } {
  const ref = useRef<HTMLInputElement>(null);

  async function handle(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      await onText(text);
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    }
  }

  const input = (
    <input
      ref={ref}
      type="file"
      accept=".csv,text/csv"
      className="hidden"
      onChange={handle}
    />
  );

  return { trigger: () => ref.current?.click(), input };
}

// Sanitize a name into a download-safe filename fragment.
// "My Flow!" → "My_Flow_"
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_-]+/gi, "_");
}
