import { useSpecStore } from "@/lib/store/spec";
import { genId } from "@/lib/ids";
import type { Guardrail, GuardrailModality } from "@/lib/schema/v0";
import { ListEditor } from "@/components/inspector/ListEditor";
import { inputClass } from "@/components/inspector/primitives";
import { SheetShell } from "./SheetShell";

const MODALITIES: GuardrailModality[] = ["must", "should"];

export function GuardrailsSheet({ onClose }: { onClose: () => void }) {
  const guardrails = useSpecStore((s) => s.spec?.agent.guardrails) ?? [];
  const updateAgent = useSpecStore((s) => s.updateAgent);
  const mustCount = guardrails.filter((g) => (g.modality ?? "must") === "must").length;
  const shouldCount = guardrails.length - mustCount;

  return (
    <SheetShell
      title={`Guardrails${guardrails.length ? ` (${mustCount} must · ${shouldCount} should)` : ""}`}
      subtitle="Cross-cutting behavioral invariants applied to the full transcript."
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <ListEditor<Guardrail>
        items={guardrails}
        onChange={(g) => updateAgent({ guardrails: g.length ? g : undefined })}
        newItem={() => ({ id: genId("g"), statement: "", modality: "must" })}
        addLabel="add guardrail"
        renderItem={(g, update, remove) => (
          <div className="flex items-start gap-2">
            <select
              className="rounded border border-zinc-300 px-2 py-1 text-xs bg-white mt-0.5"
              value={g.modality ?? "must"}
              onChange={(e) => update({ ...g, modality: e.target.value as GuardrailModality })}
              title="must = invariant; should = preference, yields to user context"
            >
              {MODALITIES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
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
