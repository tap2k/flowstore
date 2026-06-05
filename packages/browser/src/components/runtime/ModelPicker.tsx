import { BUILT_IN_MODELS } from "@flowstore/core/files/models";
import {
  hasKeyForModel,
  resolveDispatch,
  supportsStructuredOutput,
  useSettingsStore,
  type KeyOverrides,
} from "@/lib/store/settings";

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
  // When true, only models whose provider supports strict structured output
  // (Google / OpenAI) are listed — for pickers that back schema-constrained
  // generation, where any other model would throw at dispatch.
  structuredOnly?: boolean;
  // Draft keys (keyed by endpoint) that take precedence over the persisted
  // store when deciding key presence. The Settings sheet passes its unsaved
  // key fields so a just-typed key clears "(no key)" before Save.
  keyOverrides?: KeyOverrides;
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
  structuredOnly = false,
  keyOverrides,
}: ModelPickerProps) {
  // Subscribe to the provider keys so the option list re-renders the moment a
  // key is added or cleared. hasKeyForModel/resolveDispatch read the store
  // imperatively via getState(); without these subscriptions the filtered list
  // would go stale (a newly-keyed model wouldn't appear, a cleared one wouldn't
  // drop) until some unrelated re-render.
  useSettingsStore((s) => s.googleApiKey);
  useSettingsStore((s) => s.openaiApiKey);
  useSettingsStore((s) => s.openrouterApiKey);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      disabled={disabled}
      title={title}
    >
      {Object.entries(BUILT_IN_MODELS.models)
        .filter(([id]) => {
          // Always keep the current selection visible, else the select
          // renders blank when value is filtered out.
          if (id === value) return true;
          if (structuredOnly && !supportsStructuredOutput(id)) return false;
          if (!showUnconfigured && !hasKeyForModel(id, keyOverrides)) return false;
          return true;
        })
        .map(([id, m]) => {
          const r = resolveDispatch(id, keyOverrides);
          const missing = !r.apiKey.trim();
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
