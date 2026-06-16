import { useState } from "react";

// Tags surfaced as chips on each row. flow:<id> chips get an indigo tint;
// src:* provenance tags are hidden (bookkeeping, not useful at-a-glance).
export function TagChips({ tags }: { tags: string[] | undefined }) {
  if (!tags?.length) return null;
  const shown = tags.filter((t) => !t.startsWith("src:"));
  if (shown.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {shown.map((t) => {
        const isFlow = t.startsWith("flow:");
        return (
          <span
            key={t}
            title={t}
            className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
              isFlow ? "bg-indigo-100 text-indigo-700" : "bg-zinc-100 text-zinc-600"
            }`}
          >
            {isFlow ? t.slice("flow:".length) : t}
          </span>
        );
      })}
    </div>
  );
}

// Minimal tags editor: chips with × remove + a native <datalist> for
// autocomplete from the caller-supplied vocabulary.
export function TagsField({
  tags,
  suggestions,
  listId,
  onChange,
}: {
  tags: string[];
  suggestions: string[];
  listId: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  function add(raw: string) {
    const t = raw.trim();
    setDraft("");
    if (!t || tags.includes(t)) return;
    onChange([...tags, t]);
  }
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
        tags
      </label>
      {tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {tags.map((t) => {
            const isFlow = t.startsWith("flow:");
            return (
              <span
                key={t}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  isFlow ? "bg-indigo-100 text-indigo-700" : "bg-zinc-100 text-zinc-600"
                }`}
              >
                {isFlow ? t.slice("flow:".length) : t}
                <button
                  type="button"
                  onClick={() => onChange(tags.filter((x) => x !== t))}
                  title="remove tag"
                  className="leading-none text-zinc-400 hover:text-red-600"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
      <input
        type="text"
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => add(draft)}
        placeholder="add tag — e.g. happy-path, negotiation, flow:…"
        className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
      />
      <datalist id={listId}>
        {draft.trim() !== "" && suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}
