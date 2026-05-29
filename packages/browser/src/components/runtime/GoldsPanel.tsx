import { useEffect, useState } from "react";
import type { Gold } from "@flowstore/core/schema/files/gold";
import { useTestsStore } from "@/lib/store/tests";

// Saved-gold library for the Run pill's Golds tab. Same vertical
// list-with-inline-expand pattern as Personas. Golds are file-backed
// (tests/gold/<id>.gold.json) — save / delete mark the project dirty
// and ride on the next GitHub Save. New golds usually originate from
// Simulate capture (capture ▾ → as gold), but `+ New` here creates a
// placeholder if a designer wants to author one from scratch.

export function GoldsPanel() {
  const golds = useTestsStore((s) => s.golds);
  const saveGold = useTestsStore((s) => s.saveGold);
  const deleteGold = useTestsStore((s) => s.deleteGold);
  const uniqueGoldId = useTestsStore((s) => s.uniqueGoldId);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  function startNew() {
    const defaultName = `Gold ${golds.length + 1}`;
    const id = uniqueGoldId(defaultName);
    saveGold({
      $schema: "flowstore://test/gold/v0",
      id,
      name: defaultName,
      scenario: "",
      turns: [],
    });
    setSelectedId(id);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
        <div className="text-[11px] text-zinc-500">
          {golds.length} {golds.length === 1 ? "gold" : "golds"}
        </div>
        <button
          type="button"
          onClick={startNew}
          title="Create a new gold (rename + fill it inline). You can also capture from the Simulate tab."
          className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {golds.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-500">
            No golds yet. Click <span className="font-medium">+ New</span> or
            capture a transcript from the Simulate tab.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {golds.map((g) => (
              <GoldRow
                key={g.id}
                gold={g}
                expanded={selectedId === g.id}
                onToggle={() => setSelectedId(selectedId === g.id ? null : g.id)}
                onSave={(updated) => saveGold(updated)}
                onDelete={() => {
                  const ok = window.confirm(`Delete gold "${g.name || g.id}"?`);
                  if (!ok) return;
                  deleteGold(g.id);
                  if (selectedId === g.id) setSelectedId(null);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface GoldRowProps {
  gold: Gold;
  expanded: boolean;
  onToggle: () => void;
  onSave: (g: Gold) => void;
  onDelete: () => void;
}

function GoldRow({ gold, expanded, onToggle, onSave, onDelete }: GoldRowProps) {
  const [name, setName] = useState(gold.name);
  const [scenario, setScenario] = useState(gold.scenario);
  const [turns, setTurns] = useState(gold.turns);

  useEffect(() => {
    if (expanded) {
      setName(gold.name);
      setScenario(gold.scenario);
      setTurns(gold.turns);
    }
  }, [expanded, gold]);

  const dirty =
    name !== gold.name ||
    scenario !== gold.scenario ||
    JSON.stringify(turns) !== JSON.stringify(gold.turns);

  function handleSave() {
    onSave({
      $schema: "flowstore://test/gold/v0",
      id: gold.id,
      name,
      scenario,
      turns,
      ...(gold.source_pointer !== undefined ? { source_pointer: gold.source_pointer } : {}),
    });
  }

  function updateTurnText(i: number, text: string) {
    setTurns(turns.map((t, idx) => (idx === i ? { ...t, text } : t)));
  }
  function removeTurn(i: number) {
    // Re-derive alternation from the kept first turn's role so the
    // sequence stays purely agent ↔ user.
    const kept = turns.filter((_, idx) => idx !== i);
    const startRole = kept[0]?.role ?? "agent";
    setTurns(
      kept.map((t, idx) => ({
        ...t,
        role: idx % 2 === 0 ? startRole : startRole === "agent" ? "user" : "agent",
      })),
    );
  }
  function addTurn() {
    // Add the opposite role of the last turn. Empty list defaults to
    // agent (matches the chatbot_initiates=true convention; the
    // "Starts with" toggle below flips the whole sequence if wrong).
    const lastRole = turns[turns.length - 1]?.role;
    const nextRole: "agent" | "user" =
      lastRole === "agent" ? "user" : lastRole === "user" ? "agent" : "agent";
    setTurns([...turns, { role: nextRole, text: "" }]);
  }
  function flipFirstSpeaker() {
    // Flip every turn's role so the sequence still strictly alternates
    // but with the opposite speaker leading.
    setTurns(
      turns.map((t) => ({
        ...t,
        role: t.role === "agent" ? "user" : "agent",
      })),
    );
  }
  const firstRole = turns[0]?.role ?? "agent";

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-zinc-900">
            {gold.name || gold.id}
          </div>
          <div className="truncate font-mono text-[10px] text-zinc-500">{gold.id}</div>
        </div>
        <span className="ml-2 text-zinc-400">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-zinc-100 bg-zinc-50/50 px-3 py-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
              name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px]"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
              scenario
            </label>
            <textarea
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              rows={2}
              placeholder="One-line description of what happens."
              className="w-full resize-y rounded border border-zinc-300 bg-white p-1.5 text-[11px] leading-snug"
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-[10px] uppercase tracking-wide text-zinc-500">
                turns
              </label>
              {turns.length > 0 && (
                <button
                  type="button"
                  onClick={flipFirstSpeaker}
                  title="Flip every turn's role so the sequence still alternates but with the opposite speaker first."
                  className="text-[10px] text-zinc-500 hover:text-zinc-900 underline-offset-2 hover:underline"
                >
                  starts with: {firstRole}
                </button>
              )}
            </div>
            <div className="space-y-1">
              {turns.length === 0 && (
                <div className="text-[11px] text-zinc-500 italic">
                  No turns. Click + add turn to start.
                </div>
              )}
              {turns.map((t, i) => (
                <div key={i} className="flex items-start gap-1">
                  <span className="mt-1 w-10 shrink-0 text-right font-mono text-[10px] text-zinc-500">
                    {t.role}
                  </span>
                  <textarea
                    value={t.text}
                    onChange={(e) => updateTurnText(i, e.target.value)}
                    rows={1}
                    className="flex-1 resize-y rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => removeTurn(i)}
                    className="mt-0.5 rounded border border-zinc-200 bg-white px-1 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addTurn}
                className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
              >
                + add turn
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onDelete}
              className="rounded border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty}
              title={dirty ? "Save changes" : "No unsaved edits"}
              className="rounded-md bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
