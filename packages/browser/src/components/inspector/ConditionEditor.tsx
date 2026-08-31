import type { Condition, Method } from "@flowstore/core/schema/v0";
import { AutoTextarea } from "@/components/ui";

const METHODS: Method[] = ["llm", "calculation", "direct"];

interface ConditionEditorProps {
  condition: Condition | undefined;
  onChange: (c: Condition | undefined) => void;
  placeholder?: string;
  required?: boolean;
}

export function ConditionEditor({ condition, onChange, placeholder, required }: ConditionEditorProps) {
  const method: Method = condition?.method ?? "llm";
  const expression = condition?.expression ?? "";

  function update(next: Partial<Condition>) {
    const merged: Condition = { method, expression, ...next };
    if (!required && !merged.expression) {
      onChange(undefined);
    } else {
      onChange(merged);
    }
  }

  return (
    <div className="space-y-1.5">
      <select
        className="rounded border border-border-default px-2 py-1 fs-caption bg-surface-panel"
        value={method}
        onChange={(e) => update({ method: e.target.value as Method })}
      >
        {METHODS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <AutoTextarea
        className="w-full rounded border border-border-default px-2 py-1 fs-data min-h-[50px] focus:outline-none focus:ring-1 focus:ring-focus-ring"
        value={expression}
        onChange={(e) => update({ expression: e.target.value })}
        placeholder={placeholder ?? (method === "llm" ? "Plain-language description" : "Expression")}
      />
    </div>
  );
}
