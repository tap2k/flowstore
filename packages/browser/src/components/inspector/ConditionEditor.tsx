import type { Condition, Method } from "@uxflows/core/schema/v0";

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
        className="rounded border border-zinc-300 px-2 py-1 text-xs bg-white"
        value={method}
        onChange={(e) => update({ method: e.target.value as Method })}
      >
        {METHODS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <textarea
        className="w-full rounded border border-zinc-300 px-2 py-1 text-xs font-mono resize-y min-h-[50px] focus:outline-none focus:ring-1 focus:ring-zinc-400"
        value={expression}
        onChange={(e) => update({ expression: e.target.value })}
        placeholder={placeholder ?? (method === "llm" ? "Plain-language description" : "Expression")}
      />
    </div>
  );
}
