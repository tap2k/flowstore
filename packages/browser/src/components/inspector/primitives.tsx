import type { ReactNode } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { Button, IconButton } from "@/components/ui";

// Shared class strings for the many raw <input>/<textarea>/<select> elements
// across the inspector and the sheets. They resolve to the same tokens the
// Input atom uses — recessed sunken fill, 1px border, focus halo — so a field
// styled by hand and one built from the atom read identically.
export const inputClass =
  "w-full rounded-2 border border-border-default bg-surface-sunken px-2 py-1 fs-ui text-text-primary " +
  "placeholder:text-text-tertiary hover:border-border-strong focus:outline-none " +
  "focus:border-n-11 focus:shadow-[0_0_0_2px_var(--select-halo)]";

export const labelClass = "fs-label block text-text-secondary mb-1";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      {children}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      {/* Structural header: uppercase, tertiary, over a hairline. Grouping is a
          divider and a header in this system, never a card. */}
      <div className="flex items-baseline justify-between border-b border-border-subtle pb-1">
        <h3 className="fs-panelHeader text-text-tertiary">{title}</h3>
        {action && <div className="flex items-center gap-3">{action}</div>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function StringListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      {items.map((s, i) => (
        <div key={i} className="group/row flex items-center gap-1">
          <input
            className={inputClass}
            value={s}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={placeholder}
          />
          <IconButton
            icon={X}
            label="Remove"
            size="sm"
            // Visible on hover/focus of THIS row only — group/row is scoped per
            // item, not shared across the list, so hovering one row's remove
            // button doesn't light up every other row's.
            className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button variant="ghost" size="sm" icon={Plus} onClick={() => onChange([...items, ""])}>
        Add
      </Button>
    </div>
  );
}
