import type { VariableDecl } from "@flowstore/core/schema/v0";
import { coerceValue } from "@flowstore/core/runtime/contextVars";

interface Props {
  decl: VariableDecl | undefined;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown) => void;
}

const baseInput =
  "w-full rounded border bg-surface-panel px-2 py-1 fs-caption text-text-primary focus:outline-none focus:ring-1 focus:ring-focus-ring disabled:bg-state-disabled-bg";

// When `decl` is undefined the value is treated as a free string.
export function TypedValueInput({ decl, value, disabled, onChange }: Props) {
  const type = decl?.type ?? "string";
  const filled = value !== undefined && value !== null && value !== "";
  const className = `${baseInput} ${filled ? "border-border-default" : "border-dashed border-border-default"}`;

  const coerce = (raw: string | boolean): unknown => {
    if (decl) return coerceValue(decl, raw);
    if (typeof raw === "boolean") return raw;
    return raw.trim() === "" ? undefined : raw.trim();
  };

  if (type === "enum") {
    return (
      <select
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(e) => onChange(coerce(e.target.value))}
        className={className}
      >
        <option value="">(unset)</option>
        {(decl?.values ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  if (type === "boolean") {
    return (
      <select
        value={value === true ? "true" : value === false ? "false" : ""}
        disabled={disabled}
        onChange={(e) => onChange(coerce(e.target.value))}
        className={className}
      >
        <option value="">(unset)</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (type === "number") {
    return (
      <input
        type="number"
        value={typeof value === "number" ? value : value === undefined ? "" : String(value)}
        disabled={disabled}
        onChange={(e) => onChange(coerce(e.target.value))}
        placeholder="—"
        className={className}
      />
    );
  }
  return (
    <input
      type="text"
      value={typeof value === "string" ? value : value === undefined ? "" : String(value)}
      disabled={disabled}
      onChange={(e) => onChange(coerce(e.target.value))}
      placeholder="—"
      className={className}
    />
  );
}
