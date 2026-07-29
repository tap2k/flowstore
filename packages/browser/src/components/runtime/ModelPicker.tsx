import { BUILT_IN_MODELS } from "@flowstore/core/files/models";
import type { ModelEntry } from "@flowstore/core/files/models";
import {
  hasKeyForModel,
  resolveDispatch,
  useSettingsStore,
  type KeyOverrides,
} from "@/lib/store/settings";
import { useModelsStore } from "@/lib/store/models";

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
  // When true, only Live-capable (voice-tagged) models are listed — for the
  // Simulation panel's voice mode, which can only dispatch to a Live model.
  voiceOnly?: boolean;
  // When true, voice-tagged models are listed ALONGSIDE text models — for
  // compare's columns, where an s2s model is just another column. Default
  // false: surfaces that can only dispatch chat completions hide them.
  includeVoice?: boolean;
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
  voiceOnly = false,
  includeVoice = false,
  keyOverrides,
}: ModelPickerProps) {
  // Subscribe to the provider keys and project models so the option list
  // re-renders the moment a key is added or a project is loaded/cleared.
  // hasKeyForModel/resolveDispatch read the store imperatively via getState();
  // without these subscriptions the filtered list would go stale.
  useSettingsStore((s) => s.googleApiKey);
  useSettingsStore((s) => s.openaiApiKey);
  useSettingsStore((s) => s.openrouterApiKey);
  const projectConfig = useModelsStore((s) => s.config);

  // Merge built-in and project models; project entries shadow built-ins with
  // the same key. Project entries are shown in a separate optgroup.
  const builtinEntries = Object.entries(BUILT_IN_MODELS.models);
  const projectEntries: [string, ModelEntry][] = projectConfig
    ? Object.entries(projectConfig.models).filter(([id]) => !(id in BUILT_IN_MODELS.models))
    : [];

  function filterEntry(id: string, m: ModelEntry): boolean {
    if (voiceOnly ? !m.voice : !!m.voice && !includeVoice) return false;
    if (id === value) return true;
    if (!showUnconfigured && !hasKeyForModel(id, keyOverrides)) return false;
    return true;
  }

  function renderOption(id: string, m: ModelEntry) {
    const r = resolveDispatch(id, keyOverrides);
    const missing = !r.apiKey.trim() && !r.baseUrl;
    return (
      <option key={id} value={id}>
        {m.name ?? id}
        {missing ? " (no key)" : ""}
      </option>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      disabled={disabled}
      title={title}
    >
      {builtinEntries.filter(([id, m]) => filterEntry(id, m)).map(([id, m]) => renderOption(id, m))}
      {projectEntries.length > 0 && (
        <optgroup label="Project endpoints">
          {projectEntries.filter(([id, m]) => filterEntry(id, m)).map(([id, m]) => renderOption(id, m))}
        </optgroup>
      )}
    </select>
  );
}
