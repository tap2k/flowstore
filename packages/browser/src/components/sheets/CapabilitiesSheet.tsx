import { useSpecStore } from "@/lib/store/spec";
import { useSettingsStore } from "@/lib/store/settings";
import { genId } from "@flowstore/core/ids";
import type { Capability, CapabilityKind } from "@flowstore/core/schema/v0";
import { ListEditor } from "@/components/inspector/ListEditor";
import { inputClass, StringListEditor } from "@/components/inspector/primitives";
import { SheetShell } from "./SheetShell";

export function CapabilitiesSheet({ onClose }: { onClose: () => void }) {
  const capabilities = useSpecStore((s) => s.spec?.agent.capabilities) ?? [];
  const updateAgent = useSpecStore((s) => s.updateAgent);
  const runnerUrl = useSettingsStore((s) => s.runnerUrl);
  // non_blocking (and its pending_message) is honored only by the runner —
  // prompt mode resolves every tool call synchronously — so only surface it
  // when a runner is plausibly in play (mirrors the visible_when gate), or
  // when the spec already carries it. ends_conversation is NOT gated: prompt
  // mode honors it (the sim ends the session on the captured invocation).
  const runnerFeatures = import.meta.env.VITE_DEV === "1" || runnerUrl !== "";

  return (
    <SheetShell
      title="Capabilities"
      subtitle="Catalog of external integrations the agent dispatches."
      onClose={onClose}
    >
      <ListEditor<Capability>
        items={capabilities}
        onChange={(c) => updateAgent({ capabilities: c.length ? c : undefined })}
        newItem={() => ({
          id: genId("cap"),
          name: "",
          description: "",
          kind: "function" as CapabilityKind,
        })}
        addLabel="add capability"
        renderItem={(c, update, remove) => (
          <div className="rounded border border-zinc-200 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <input
                className={inputClass}
                value={c.name}
                onChange={(e) => update({ ...c, name: e.target.value })}
                placeholder="snake_case_name"
              />
              <select
                className={`${inputClass} w-32`}
                value={c.kind}
                onChange={(e) => update({ ...c, kind: e.target.value as CapabilityKind })}
              >
                <option value="function">function</option>
                <option value="retrieval">retrieval</option>
              </select>
              <button
                onClick={remove}
                className="text-xs text-zinc-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
            <textarea
              className={`${inputClass} resize-y min-h-[40px]`}
              value={c.description}
              onChange={(e) => update({ ...c, description: e.target.value })}
              placeholder="when/why this is used"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="block text-[10px] text-zinc-500 mb-1">inputs</span>
                <StringListEditor
                  items={c.inputs ?? []}
                  onChange={(inputs) =>
                    update({ ...c, inputs: inputs.length ? inputs : undefined })
                  }
                  placeholder="variable_name"
                />
              </div>
              <div>
                <span className="block text-[10px] text-zinc-500 mb-1">outputs</span>
                <StringListEditor
                  items={c.outputs ?? []}
                  onChange={(outputs) =>
                    update({ ...c, outputs: outputs.length ? outputs : undefined })
                  }
                  placeholder="variable_name"
                />
              </div>
            </div>
            {c.kind === "function" && (
              <div className="space-y-1.5 pt-1">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-600">
                    <input
                      type="checkbox"
                      checked={c.ends_conversation ?? false}
                      onChange={(e) =>
                        update({ ...c, ends_conversation: e.target.checked || undefined })
                      }
                    />
                    Ends the conversation
                  </label>
                  {(runnerFeatures || c.non_blocking) && (
                    <label className="flex items-center gap-1.5 text-[11px] text-zinc-600">
                      <input
                        type="checkbox"
                        checked={c.non_blocking ?? false}
                        onChange={(e) => update({ ...c, non_blocking: e.target.checked || undefined })}
                      />
                      Non-blocking (keep the conversation going while it runs)
                    </label>
                  )}
                </div>
                {c.non_blocking && (
                  <input
                    className={inputClass}
                    value={typeof c.pending_message === "string" ? c.pending_message : ""}
                    onChange={(e) =>
                      update({ ...c, pending_message: e.target.value || undefined })
                    }
                    placeholder="Holding line while it runs (optional) — “Let me pull that up…”"
                  />
                )}
              </div>
            )}
          </div>
        )}
      />
    </SheetShell>
  );
}
