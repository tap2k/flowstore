import { useSpecStore } from "@/lib/store/spec";
import { genId } from "@/lib/ids";
import type { BusinessGoal, Method } from "@/lib/schema/v0";
import { ListEditor } from "@/components/inspector/ListEditor";
import { inputClass } from "@/components/inspector/primitives";
import { SheetShell } from "./SheetShell";

const METHODS: Method[] = ["llm", "calculation", "direct"];

export function BusinessGoalsSheet({ onClose }: { onClose: () => void }) {
  const goals = useSpecStore((s) => s.spec?.agent.business_goals) ?? [];
  const updateAgent = useSpecStore((s) => s.updateAgent);

  return (
    <SheetShell
      title="Business goals"
      subtitle="End-to-end outcomes the agent is judged against. Distinct from guardrails — describe what success looks like at the conversation level."
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <ListEditor<BusinessGoal>
        items={goals}
        onChange={(g) => updateAgent({ business_goals: g.length ? g : undefined })}
        newItem={() => ({ id: genId("goal"), name: "", expression: "", method: "llm" })}
        addLabel="add goal"
        renderItem={(g, update, remove) => (
          <div className="space-y-1.5 border border-zinc-200 rounded-md p-2">
            <div className="flex items-start gap-2">
              <input
                className={inputClass}
                value={g.name}
                onChange={(e) => update({ ...g, name: e.target.value })}
                placeholder="Goal name (shown in evaluation reports)"
              />
              <button
                onClick={remove}
                className="text-xs text-zinc-400 hover:text-red-600 mt-1"
              >
                ×
              </button>
            </div>
            <div className="flex items-start gap-2">
              <select
                className="rounded border border-zinc-300 px-2 py-1 text-xs bg-white"
                value={g.method}
                onChange={(e) => update({ ...g, method: e.target.value as Method })}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <textarea
                className="flex-1 rounded border border-zinc-300 px-2 py-1 text-xs font-mono resize-y min-h-[40px] focus:outline-none focus:ring-1 focus:ring-zinc-400"
                value={g.expression}
                onChange={(e) => update({ ...g, expression: e.target.value })}
                placeholder={
                  g.method === "llm"
                    ? "Rubric the evaluator scores over the transcript"
                    : g.method === "calculation"
                      ? 'Expression over captured variables (e.g. order_status == "confirmed")'
                      : "Literal value"
                }
              />
            </div>
          </div>
        )}
      />
    </SheetShell>
  );
}
