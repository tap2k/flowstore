import { useMemo, useEffect, useRef, useState } from "react";
import type { Gold } from "@flowstore/core/schema/files/gold";
import type { MockBehavior } from "@flowstore/core/schema/files/mockBehavior";
import { useTestsStore } from "@/lib/store/tests";
import { useSimulateStore } from "@/lib/store/simulate";
import { useUiStore } from "@/lib/store/ui";
import { useSpecStore } from "@/lib/store/spec";
import { collectDeclaredVariables, type DeclaredVariable } from "@flowstore/core/runtime/contextVars";
import { collectMockableCapabilities, type MockableCapability } from "@flowstore/core/runtime/capabilityMocks";
import { caseWorldToRuntime } from "@flowstore/core/runtime/personaRuntime";
import { VarsEditor } from "./persona/VarsEditor";
import { MocksEditor } from "./persona/MocksEditor";
import { TagChips, TagsField } from "./TagsUI";
import { DisclosureCaret } from "@/components/ui";

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
  const saveCase = useTestsStore((s) => s.saveCase);
  const uniqueCaseId = useTestsStore((s) => s.uniqueCaseId);
  const setPendingCaseId = useTestsStore((s) => s.setPendingCaseId);
  const spec = useSpecStore((s) => s.spec);
  const cases = useTestsStore((s) => s.cases);
  const declared = useMemo(() => spec ? collectDeclaredVariables(spec) : [], [spec]);

  // Selection lives in the store so a Simulate capture (capture ▾ → as
  // gold) can open the freshly created gold's editor on tab switch.
  const selectedId = useTestsStore((s) => s.selectedGoldId);
  const setSelectedId = useTestsStore((s) => s.setSelectedGoldId);

  // "▶ Run" replays a gold's user turns through the live agent on the
  // Simulate tab; the SimulatePanel reads activeGoldId to drive the run and
  // the gold-vs-live comparison.
  const reset = useSimulateStore((s) => s.reset);
  const setActiveGoldId = useSimulateStore((s) => s.setActiveGoldId);
  const setContextVars = useSimulateStore((s) => s.setContextVars);
  const setMockReturns = useSimulateStore((s) => s.setMockReturns);
  const setMockError = useSimulateStore((s) => s.setMockError);
  const setOpenSimulateTab = useUiStore((s) => s.setOpenSimulateTab);
  const mockableCaps = useMemo(() => collectMockableCapabilities(spec), [spec]);

  const tagSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const g of golds) for (const t of g.tags ?? []) set.add(t);
    for (const c of cases) for (const t of c.tags ?? []) set.add(t);
    for (const f of spec?.flows ?? []) set.add(`flow:${f.id}`);
    return [...set].sort();
  }, [golds, cases, spec]);

  function startNew() {
    const defaultName = `Gold ${golds.length + 1}`;
    const id = uniqueGoldId(defaultName);
    saveGold({
      $schema: "flowstore://test/gold/v0",
      id,
      name: defaultName,
      turns: [],
    });
    setSelectedId(id);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-border-default px-3 py-1.5">
        <div className="text-[11px] text-text-tertiary">
          {golds.length} {golds.length === 1 ? "gold" : "golds"}
        </div>
        <button
          type="button"
          onClick={startNew}
          title="Create a new gold (rename + fill it inline). You can also capture from the Simulate tab."
          className="rounded border border-border-default bg-surface-panel px-2 py-0.5 text-[11px] text-text-secondary hover:bg-surface-hover"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {golds.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-text-tertiary">
            No golds yet. Click <span className="font-medium">+ New</span> or
            capture a transcript from the Simulate tab.
          </div>
        ) : (
          <ul className="divide-y divide-border-default">
            {golds.map((g) => (
              <GoldRow
                key={g.id}
                gold={g}
                expanded={selectedId === g.id}
                declared={declared}
                mockableCaps={mockableCaps}
                tagSuggestions={tagSuggestions}
                onToggle={() => setSelectedId(selectedId === g.id ? null : g.id)}
                onRun={async () => {
                  await reset();
                  if (spec) {
                    const { vars: rVars, returns, errors } = caseWorldToRuntime(
                      spec,
                      undefined,
                      { vars: g.vars, mocks: g.mocks },
                    );
                    setContextVars(rVars);
                    setMockReturns(returns);
                    for (const [name, err] of Object.entries(errors)) {
                      setMockError(name, err);
                    }
                  }
                  setActiveGoldId(g.id);
                  setOpenSimulateTab("simulate");
                }}
                onSave={(updated) => saveGold(updated)}
                onCopy={() => {
                  const base = g.name ? `${g.name} copy` : `${g.id}-copy`;
                  const newId = uniqueGoldId(base);
                  saveGold({
                    ...g,
                    id: newId,
                    ...(g.name ? { name: `${g.name} copy` } : {}),
                  });
                  setSelectedId(newId);
                }}
                onDelete={() => {
                  const ok = window.confirm(`Delete gold "${g.name || g.id}"?`);
                  if (!ok) return;
                  deleteGold(g.id);
                  if (selectedId === g.id) setSelectedId(null);
                }}
                onCreateTest={() => {
                  const userTurns = g.turns
                    .filter((t) => t.role === "user")
                    .map((t) => t.text);
                  const newId = uniqueCaseId(g.name ?? g.id);
                  saveCase({
                    $schema: "flowstore://test/case/v0",
                    id: newId,
                    ...(g.name ? { name: g.name } : {}),
                    user_turns: userTurns,
                  });
                  setPendingCaseId(newId);
                  setOpenSimulateTab("tests");
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
  declared: DeclaredVariable[];
  mockableCaps: MockableCapability[];
  tagSuggestions: string[];
  onToggle: () => void;
  onRun: () => void;
  onSave: (g: Gold) => void;
  onCopy: () => void;
  onDelete: () => void;
  onCreateTest: () => void;
}

function GoldRow({ gold, expanded, declared, mockableCaps, tagSuggestions, onToggle, onRun, onSave, onCopy, onDelete, onCreateTest }: GoldRowProps) {
  const [name, setName] = useState(gold.name ?? "");
  const [notes, setNotes] = useState(gold.notes ?? "");
  const [tags, setTags] = useState<string[]>(gold.tags ?? []);
  const [turns, setTurns] = useState(gold.turns);
  const [vars, setVars] = useState<Record<string, unknown>>(gold.vars ?? {});
  const [mocks, setMocks] = useState<Record<string, MockBehavior>>(gold.mocks ?? {});
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (expanded) {
      setName(gold.name ?? "");
      setNotes(gold.notes ?? "");
      setTags(gold.tags ?? []);
      setTurns(gold.turns);
      setVars(gold.vars ?? {});
      setMocks(gold.mocks ?? {});
    }
  }, [expanded, gold]);

  // A freshly captured / "+ New" gold is appended at the bottom of the
  // list and opens expanded — scroll it into view so it isn't stranded
  // below the fold when the Golds tab mounts after a Simulate capture.
  useEffect(() => {
    if (expanded) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [expanded]);

  const dirty =
    name !== (gold.name ?? "") ||
    notes !== (gold.notes ?? "") ||
    JSON.stringify(tags) !== JSON.stringify(gold.tags ?? []) ||
    JSON.stringify(turns) !== JSON.stringify(gold.turns) ||
    JSON.stringify(vars) !== JSON.stringify(gold.vars ?? {}) ||
    JSON.stringify(mocks) !== JSON.stringify(gold.mocks ?? {});

  function handleSave() {
    onSave({
      $schema: "flowstore://test/gold/v0",
      id: gold.id,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(gold.source_pointer !== undefined ? { source_pointer: gold.source_pointer } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(Object.keys(vars).length > 0 ? { vars } : {}),
      ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
      turns,
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
  // A gold can only be replayed if it has user turns to feed the agent.
  const userTurnCount = gold.turns.filter((t) => t.role === "user").length;

  return (
    <li ref={rowRef}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface-hover"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-text-primary">
            {gold.name || gold.id}
          </div>
          <div className="truncate font-mono text-[10px] text-text-tertiary">{gold.id}</div>
          <TagChips tags={gold.tags} />
        </div>
        <DisclosureCaret open={expanded} className="ml-2" />
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-border-subtle bg-surface-sunken/50 px-3 py-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-text-tertiary">
              name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-border-default bg-surface-panel px-2 py-1 text-[11px]"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-text-tertiary">
              notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="One-line description of what happens."
              className="w-full resize-y rounded border border-border-default bg-surface-panel p-1.5 text-[11px] leading-snug"
            />
          </div>

          <TagsField
            tags={tags}
            suggestions={tagSuggestions}
            listId={`gold-tag-suggestions-${gold.id}`}
            onChange={setTags}
          />

          {declared.length > 0 && (
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-text-tertiary">
                vars
              </label>
              <VarsEditor
                declared={declared}
                values={vars}
                onChange={(varName, value) => setVars((prev) => ({ ...prev, [varName]: value }))}
              />
            </div>
          )}

          {mockableCaps.length > 0 && (
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-text-tertiary">
                mocks
              </label>
              <MocksEditor
                caps={mockableCaps}
                behaviors={mocks}
                keyOf={(cap) => cap.capabilityId}
                onChange={(k, behavior) => {
                  const next = { ...mocks };
                  if (behavior === undefined) {
                    delete next[k];
                  } else {
                    next[k] = behavior;
                  }
                  setMocks(next);
                }}
              />
            </div>
          )}

          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-[10px] uppercase tracking-wide text-text-tertiary">
                turns
              </label>
              {turns.length > 0 && (
                <button
                  type="button"
                  onClick={flipFirstSpeaker}
                  title="Flip every turn's role so the sequence still alternates but with the opposite speaker first."
                  className="text-[10px] text-text-tertiary hover:text-text-primary underline-offset-2 hover:underline"
                >
                  starts with: {firstRole}
                </button>
              )}
            </div>
            <div className="space-y-1">
              {turns.length === 0 && (
                <div className="text-[11px] text-text-tertiary italic">
                  No turns. Click + add turn to start.
                </div>
              )}
              {turns.map((t, i) => (
                <div key={i} className="flex items-start gap-1">
                  <span className="mt-1 w-10 shrink-0 text-right font-mono text-[10px] text-text-tertiary">
                    {t.role}
                  </span>
                  <textarea
                    value={t.text}
                    onChange={(e) => updateTurnText(i, e.target.value)}
                    rows={1}
                    className="flex-1 resize-y rounded border border-border-default bg-surface-panel px-2 py-0.5 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => removeTurn(i)}
                    className="mt-0.5 rounded border border-border-default bg-surface-panel px-1 py-0.5 text-[10px] text-text-tertiary hover:bg-surface-hover"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addTurn}
                className="rounded border border-border-default bg-surface-panel px-2 py-0.5 text-[10px] text-text-secondary hover:bg-surface-hover"
              >
                + add turn
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onDelete}
              className="rounded border border-state-error-line bg-surface-panel px-2 py-1 text-[11px] text-state-error-fg hover:bg-state-error-bg"
            >
              Delete
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCreateTest}
                disabled={userTurnCount === 0}
                title={
                  userTurnCount === 0
                    ? "This gold has no user turns — add some before creating a test case from it."
                    : "Create a scripted test case pre-filled with this gold's user turns, then open it in the Tests tab."
                }
                className="rounded border border-border-default bg-surface-panel px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-40"
              >
                Create Test
              </button>
              <button
                type="button"
                onClick={onRun}
                disabled={userTurnCount === 0}
                title={
                  userTurnCount === 0
                    ? "This gold has no user turns to replay — add some, or capture one from a Simulate run."
                    : "Load this gold into the Simulate tab; press ▶ Run there to replay its user turns and compare against the gold."
                }
                className="rounded border border-border-default bg-surface-panel px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-40"
              >
                Open in Sim ▶
              </button>
              <button
                type="button"
                onClick={onCopy}
                title="Duplicate this gold as a new one."
                className="rounded border border-border-default bg-surface-panel px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty}
                title={dirty ? "Save changes" : "No unsaved edits"}
                className="rounded-md bg-emphasis px-3 py-1 fs-micro text-emphasis-fg hover:bg-emphasis-hover disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
