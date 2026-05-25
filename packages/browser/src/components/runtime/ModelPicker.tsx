import { BUILT_IN_MODELS } from "@flowstore/core/files/models";
import { hasKeyForModel, resolveDispatch } from "@/lib/store/settings";

interface ModelPickerProps {
  value: string;
  onChange: (id: string) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
  // When false (the default), models whose provider key isn't set are
  // hidden. Set true if a screen wants to show the picker as-is for
  // discoverability and surface a separate "missing key" error on submit.
  showUnconfigured?: boolean;
}

// Shared model picker. Filters by which provider keys are present in
// settings so a designer never picks a model they can't dispatch. Built-in
// catalog only today; consumes project models/*.json when project-level
// dispatch wiring lands.
export function ModelPicker({
  value,
  onChange,
  className,
  disabled,
  title,
  showUnconfigured = false,
}: ModelPickerProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      disabled={disabled}
      title={title}
    >
      {Object.entries(BUILT_IN_MODELS.models)
        .filter(([id]) => showUnconfigured || hasKeyForModel(id) || id === value)
        .map(([id, m]) => {
          const r = resolveDispatch(id);
          const missing = !r.apiKey;
          return (
            <option key={id} value={id}>
              {m.name ?? id}
              {missing ? " (no key)" : ""}
            </option>
          );
        })}
    </select>
  );
}
