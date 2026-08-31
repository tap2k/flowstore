import type { FaqEntry } from "@flowstore/core/schema/v0";
import { resolveLocalized, setLanguage } from "@flowstore/core/schema/v0";
import { genId } from "@flowstore/core/ids";
import { ListEditor } from "./ListEditor";
import { inputClass } from "./primitives";
import { AutoTextarea } from "@/components/ui";

interface Props {
  entries: FaqEntry[];
  onChange: (entries: FaqEntry[]) => void;
  defaultLang: string;
  addLabel?: string;
  emptyLabel?: string;
}

// Only the default language is editable inline; other languages flow through
// the Translations CSV.
export function FaqListEditor({
  entries,
  onChange,
  defaultLang,
  addLabel = "add FAQ entry",
  emptyLabel,
}: Props) {
  return (
    <ListEditor<FaqEntry>
      items={entries}
      onChange={onChange}
      newItem={() => ({ id: genId("faq"), question: "", answer: "" })}
      addLabel={addLabel}
      emptyLabel={emptyLabel}
      renderItem={(entry, update, remove) => (
        <div className="rounded border border-border-default p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              className={inputClass}
              value={entry.question}
              onChange={(e) => update({ ...entry, question: e.target.value })}
              placeholder="Question"
            />
            <button
              onClick={remove}
              className="fs-caption text-text-tertiary hover:text-state-error-fg"
              title="remove"
            >
              ×
            </button>
          </div>
          <AutoTextarea
            className={`${inputClass} min-h-[50px]`}
            value={resolveLocalized(entry.answer, defaultLang, defaultLang)}
            onChange={(e) =>
              update({
                ...entry,
                answer:
                  setLanguage(entry.answer, defaultLang, e.target.value, defaultLang) ?? "",
              })
            }
            placeholder="Answer"
          />
        </div>
      )}
    />
  );
}
