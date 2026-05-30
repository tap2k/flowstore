import { useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import type { Agent } from "@flowstore/core/schema/v0";
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
          value={agent.meta.name}
          onChange={(e) => patch({ meta: { ...agent.meta, name: e.target.value } })}
        />
      </Field>
      <Field label="Purpose">
        <textarea
          className={`${inputClass} resize-y min-h-[60px]`}
          value={agent.meta.purpose}
          onChange={(e) => patch({ meta: { ...agent.meta, purpose: e.target.value } })}
        />
      </Field>
      <Field label="Client">
        <input
          className={inputClass}
          value={agent.meta.client ?? ""}
          onChange={(e) => patch({ meta: { ...agent.meta, client: e.target.value || undefined } })}
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
      <label className="flex items-center gap-2 text-xs text-zinc-700">
        <input
          type="checkbox"
          checked={agent.chatbot_initiates ?? false}
          onChange={(e) => patch({ chatbot_initiates: e.target.checked || undefined })}
        />
        The agent sends the first message
      </label>
      <Field label="System prompt template">
        {typeof agent.system_prompt === "object" && agent.system_prompt !== null ? (
          <div className="text-[11px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded px-2 py-1.5">
            Multilingual template (
            {Object.keys(agent.system_prompt as Record<string, string>).join(", ")}
            ) — edit in JSON for now.
          </div>
        ) : (
          <textarea
            className={`${inputClass} resize-y min-h-[50px] font-mono`}
            value={agent.system_prompt ?? ""}
            onChange={(e) => patch({ system_prompt: e.target.value || undefined })}
            placeholder={"{generated}"}
          />
        )}
        <p className="text-[11px] text-zinc-500 mt-1 leading-snug">
          Free text wrapped around the compiled prompt.{" "}
          <code className="bg-zinc-100 px-1 py-0.5 rounded text-[10px]">{"{generated}"}</code>{" "}
          expands to the spec-derived sections.{" "}
          <code className="bg-zinc-100 px-1 py-0.5 rounded text-[10px]">{"{variable}"}</code>{" "}
          references work as elsewhere. Omitting{" "}
          <code className="bg-zinc-100 px-1 py-0.5 rounded text-[10px]">{"{generated}"}</code>{" "}
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

