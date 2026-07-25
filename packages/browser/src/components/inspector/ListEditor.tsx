import { Fragment, type ReactNode } from "react";

interface ListEditorProps<T> {
  items: T[];
  onChange: (items: T[]) => void;
  renderItem: (item: T, update: (next: T) => void, remove: () => void) => ReactNode;
  newItem: () => T;
  addLabel?: string;
  emptyLabel?: string;
}

export function ListEditor<T>({
  items,
  onChange,
  renderItem,
  newItem,
  addLabel = "Add",
  emptyLabel = "(none)",
}: ListEditorProps<T>) {
  function update(index: number, next: T) {
    onChange(items.map((it, i) => (i === index ? next : it)));
  }
  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }
  function add() {
    onChange([...items, newItem()]);
  }

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <div className="fs-caption text-text-tertiary italic">{emptyLabel}</div>
      )}
      {items.map((item, i) => (
        <Fragment key={i}>{renderItem(item, (n) => update(i, n), () => remove(i))}</Fragment>
      ))}
      <button
        type="button"
        onClick={add}
        className="fs-caption text-text-secondary hover:text-text-primary underline"
      >
        + {addLabel}
      </button>
    </div>
  );
}
