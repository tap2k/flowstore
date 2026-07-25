import { useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import type { Agent, Modality } from "@flowstore/core/schema/v0";
import { Field, inputClass } from "@/components/inspector/primitives";
import { SingleFlowPicker } from "@/components/inspector/FlowPicker";
import { SheetShell } from "./SheetShell";

export function AgentSheet({ onClose }: { onClose: () => void }) {
  const agent = useSpecStore((s) => s.spec?.agent ?? null);
  const updateAgent = useSpecStore((s) => s.updateAgent);

  if (!agent) return null;

  function patch(p: Partial<Agent>) {
    updateAgent(p);
  }

  return (
    <SheetShell title="Agent" inlineMeta={agent.id} onClose={onClose}>
      <Field label="Name">
        <input
          className={inputClass}
          value={agent.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Repo / display name, e.g. northwind-fnol"
        />
      </Field>
      <Field label="Identity">
        <input
          className={inputClass}
          value={agent.meta.identity}
          onChange={(e) => patch({ meta: { ...agent.meta, identity: e.target.value } })}
          placeholder="How the agent refers to itself, e.g. Nova"
        />
      </Field>
      <Field label="Purpose">
        <textarea
          className={`${inputClass} resize-y min-h-[60px]`}
          value={agent.meta.purpose}
          onChange={(e) => patch({ meta: { ...agent.meta, purpose: e.target.value } })}
        />
      </Field>
      <Field label="Tone">
        <input
          className={inputClass}
          value={agent.meta.tone ?? ""}
          onChange={(e) => patch({ meta: { ...agent.meta, tone: e.target.value || undefined } })}
          placeholder="e.g. warm and conversational, like a real barista"
        />
      </Field>
      <Field label="Languages">
        <LanguagesEditor
          languages={agent.meta.languages ?? []}
          onChange={(langs) =>
            patch({ meta: { ...agent.meta, languages: langs.length ? langs : undefined } })
          }
        />
      </Field>
      <Field label="Entry flow">
        <SingleFlowPicker
          selected={agent.entry_flow_id || null}
          onChange={(id) => patch({ entry_flow_id: id ?? "" })}
        />
      </Field>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 fs-caption text-text-secondary">
          <input
            type="checkbox"
            checked={agent.chatbot_initiates ?? false}
            onChange={(e) => patch({ chatbot_initiates: e.target.checked || undefined })}
          />
          The agent sends the first message
        </label>
        <label className="flex items-center gap-1.5 fs-caption text-text-secondary">
          Modality
          <select
            className="rounded border border-border-default bg-surface-panel px-1.5 py-0.5 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-focus-ring"
            value={agent.meta.modality}
            onChange={(e) =>
              patch({ meta: { ...agent.meta, modality: e.target.value as Modality } })
            }
          >
            <option value="voice">Voice</option>
            <option value="text">Text</option>
            {/* spec-only: hidden so it's never offered as a choice, but a spec that
                already declares "multimodal" still round-trips without a
                controlled-<select> value mismatch. */}
            <option value="multimodal" hidden>
              Multimodal
            </option>
          </select>
        </label>
      </div>
      <Field label="System prompt template">
        <textarea
          className={`${inputClass} resize-y min-h-[50px] font-mono`}
          value={agent.system_prompt ?? ""}
          onChange={(e) => patch({ system_prompt: e.target.value || undefined })}
          placeholder={"{{generated}}"}
        />
        <p className="text-[11px] text-text-tertiary mt-1 leading-snug">
          Free text wrapped around the compiled prompt.{" "}
          <code className="bg-surface-sunken px-1 py-0.5 rounded text-[10px]">{"{{generated}}"}</code>{" "}
          expands to the spec-derived sections.{" "}
          <code className="bg-surface-sunken px-1 py-0.5 rounded text-[10px]">{"{{variable}}"}</code>{" "}
          references work as elsewhere. Omitting{" "}
          <code className="bg-surface-sunken px-1 py-0.5 rounded text-[10px]">{"{{generated}}"}</code>{" "}
          fully overrides codegen.
        </p>
      </Field>
      <Field label="Notes">
        <textarea
          className={`${inputClass} resize-y min-h-[60px]`}
          value={agent.notes ?? ""}
          onChange={(e) => patch({ notes: e.target.value || undefined })}
          placeholder="Author-facing only. Not included in the compiled system prompt."
        />
      </Field>
    </SheetShell>
  );
}

function LanguagesEditor({
  languages,
  onChange,
}: {
  languages: string[];
  onChange: (langs: string[]) => void;
}) {
  const [raw, setRaw] = useState(languages.join(", "));

  function commit() {
    const parsed = raw.split(",").map((s) => s.trim()).filter(Boolean);
    onChange(parsed);
    setRaw(parsed.join(", "));
  }

  return (
    <input
      className={inputClass}
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      placeholder="EN, ES, fr-FR"
    />
  );
}

