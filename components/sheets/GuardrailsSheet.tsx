import { useSpecStore } from "@/lib/store/spec";
import { genId } from "@/lib/ids";
import type { Guardrail } from "@/lib/schema/v0";
import { ListEditor } from "@/components/inspector/ListEditor";
import { inputClass } from "@/components/inspector/primitives";
import { SheetShell } from "./SheetShell";

export function GuardrailsSheet({ onClose }: { onClose: () => void }) {
  const guardrails = useSpecStore((s) => s.spec?.agent.guardrails) ?? [];
  const updateAgent = useSpecStore((s) => s.updateAgent);

  return (
    <SheetShell
      title="Guardrails"
      subtitle="Cross-cutting behavioral invariants applied to the full transcript."
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <ListEditor<Guardrail>
        items={guardrails}
        onChange={(g) => updateAgent({ guardrails: g.length ? g : undefined })}
        newItem={() => ({ id: genId("g"), statement: "" })}
        addLabel="add guardrail"
        renderItem={(g, update, remove) => (
          <div className="flex items-start gap-2">
            <textarea
              className={`${inputClass} resize-y min-h-[40px]`}
              value={g.statement}
              onChange={(e) => update({ ...g, statement: e.target.value })}
              placeholder="Behavioral invariant"
            />
            <button
              onClick={remove}
              className="text-xs text-zinc-400 hover:text-red-600 mt-1"
            >
              ×
            </button>
          </div>
        )}
      />
    </SheetShell>
  );
}
