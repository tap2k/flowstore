import { useEffect, useMemo, useRef, useState } from "react";
import type { TestCase } from "@flowstore/core/schema/files/testCase";
import { useTestsStore } from "@/lib/store/tests";
import { useSpecStore } from "@/lib/store/spec";
import { useSimulateStore } from "@/lib/store/simulate";
import { useUiStore } from "@/lib/store/ui";

// Tests-tab case library + editor. List view by default; click a row to
// land in the editor view (Personas-tab tried inline expand, but Tests
// has too many sections for that to read well in 380px). Save persists
// to useTestsStore (which dirties the project for the next GitHub Save).
// Open in Sim ▶ loads the case's persona/mocks into Simulate and switches
// to the Simulate tab — the live-verdicts surface lands in step 6.

export function TestsPanel() {
  const cases = useTestsStore((s) => s.cases);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // If a capture just happened, jump straight to the editor for that case.
  // Track which captureContext we've already auto-selected so navigating
  // back to the list doesn't get pulled back into the editor on re-render.
  const captureContext = useTestsStore((s) => s.captureContext);
  const handledCaptureRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      captureContext &&
      captureContext.caseId !== handledCaptureRef.current &&
      cases.some((c) => c.id === captureContext.caseId)
    ) {
      setSelectedId(captureContext.caseId);
      handledCaptureRef.current = captureContext.caseId;
    }
  }, [captureContext, cases]);

  const selected = selectedId ? cases.find((c) => c.id === selectedId) ?? null : null;

  if (selected) {
    return (
      <CaseEditor
        testCase={selected}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return <CaseList cases={cases} onSelect={(id) => setSelectedId(id)} />;
}

function CaseList({
  cases,
  onSelect,
}: {
  cases: TestCase[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
        <div className="text-[11px] text-zinc-500">
          {cases.length} {cases.length === 1 ? "case" : "cases"}
        </div>
        <div
          className="text-[10px] text-zinc-400"
          title="New cases are created via the Simulate-tab capture button (capture ▾ → as test case)."
        >
          capture from Simulate
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {cases.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-500">
            No test cases yet. Play a conversation in the Simulate tab, then{" "}
            <span className="font-medium">capture ▾ → as test case</span> to seed one.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {cases.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-zinc-900">
                      {c.name || c.id}
                    </div>
                    <div className="truncate text-[10px] text-zinc-500">
                      {c.persona_id
                        ? `persona-driven · ${c.persona_id}`
                        : `${c.user_turns?.length ?? 0} scripted turns`}
                    </div>
                  </div>
                  <span className="ml-2 text-zinc-400">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface CaseEditorProps {
  testCase: TestCase;
  onBack: () => void;
}

function CaseEditor({ testCase, onBack }: CaseEditorProps) {
  const saveCase = useTestsStore((s) => s.saveCase);
  const deleteCase = useTestsStore((s) => s.deleteCase);
  const personas = useTestsStore((s) => s.personas);
  const mocksByCapability = useTestsStore((s) => s.mocksByCapability);
  const captureContext = useTestsStore((s) => s.captureContext);
  const spec = useSpecStore((s) => s.spec);
  const setPersonaPrompt = useSimulateStore((s) => s.setPersonaPrompt);
  const setMockReturns = useSimulateStore((s) => s.setMockReturns);
  const setActiveCaseId = useSimulateStore((s) => s.setActiveCaseId);
  const setOpenSimulateTab = useUiStore((s) => s.setOpenSimulateTab);

  // Draft state mirrors the saved record; Save commits the draft into the
  // store, which dirties the project for the next GitHub Save.
  const [name, setName] = useState(testCase.name ?? "");
  const [source, setSource] = useState<"scripted" | "persona">(
    testCase.persona_id ? "persona" : "scripted",
  );
  const [userTurns, setUserTurns] = useState<string[]>(testCase.user_turns ?? []);
  const [personaId, setPersonaId] = useState(testCase.persona_id ?? "");
  const [maxTurns, setMaxTurns] = useState<number>(testCase.max_turns ?? 20);
  const [mockBindings, setMockBindings] = useState<Record<string, string>>(
    testCase.mock_bindings ?? {},
  );
  const [perTurnAssertions, setPerTurnAssertions] = useState(testCase.assertions ?? []);
  const [transcriptAssertions, setTranscriptAssertions] = useState(
    testCase.transcript_assertions ?? [],
  );
  const [stateAssertions, setStateAssertions] = useState(testCase.state_assertions ?? []);
  const [evaluators, setEvaluators] = useState<string[]>(testCase.evaluators ?? []);

  // Re-hydrate draft when the selected case identity changes.
  useEffect(() => {
    setName(testCase.name ?? "");
    setSource(testCase.persona_id ? "persona" : "scripted");
    setUserTurns(testCase.user_turns ?? []);
    setPersonaId(testCase.persona_id ?? "");
    setMaxTurns(testCase.max_turns ?? 20);
    setMockBindings(testCase.mock_bindings ?? {});
    setPerTurnAssertions(testCase.assertions ?? []);
    setTranscriptAssertions(testCase.transcript_assertions ?? []);
    setStateAssertions(testCase.state_assertions ?? []);
    setEvaluators(testCase.evaluators ?? []);
  }, [testCase.id]);

  const spec_capabilities = useMemo(() => spec?.agent.capabilities ?? [], [spec]);
  const referenceTranscript =
    captureContext && captureContext.caseId === testCase.id
      ? captureContext.transcript
      : null;

  function handleSave() {
    const next: TestCase = {
      $schema: "flowstore://test/case/v0",
      id: testCase.id,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(source === "scripted" ? { user_turns: userTurns } : {}),
      ...(source === "persona" && personaId
        ? { persona_id: personaId, max_turns: maxTurns }
        : {}),
      ...(Object.keys(mockBindings).length > 0 ? { mock_bindings: mockBindings } : {}),
      ...(perTurnAssertions.length > 0 ? { assertions: perTurnAssertions } : {}),
      ...(transcriptAssertions.length > 0
        ? { transcript_assertions: transcriptAssertions }
        : {}),
      ...(stateAssertions.length > 0 ? { state_assertions: stateAssertions } : {}),
      ...(evaluators.length > 0 ? { evaluators } : {}),
      // Preserve fields the editor doesn't surface (per the planning doc:
      // vars_file / model / language / gold_id / tags stay in the schema but
      // not in the form).
      ...(testCase.vars_file !== undefined ? { vars_file: testCase.vars_file } : {}),
      ...(testCase.model !== undefined ? { model: testCase.model } : {}),
      ...(testCase.language !== undefined ? { language: testCase.language } : {}),
      ...(testCase.gold_id !== undefined ? { gold_id: testCase.gold_id } : {}),
      ...(testCase.tags !== undefined ? { tags: testCase.tags } : {}),
      ...(testCase.description !== undefined
        ? { description: testCase.description }
        : {}),
      ...(testCase.capability_assertions !== undefined
        ? { capability_assertions: testCase.capability_assertions }
        : {}),
    };
    saveCase(next);
  }

  function handleDelete() {
    const ok = window.confirm(`Delete case "${testCase.name || testCase.id}"?`);
    if (!ok) return;
    deleteCase(testCase.id);
    onBack();
  }

  function handleOpenInSimulate() {
    // Persona load (when persona-driven and persona exists in store).
    if (source === "persona" && personaId) {
      const p = personas.find((x) => x.id === personaId);
      if (p) setPersonaPrompt(p.system_prompt);
    }
    // Mock load: for each bound (capability_id, variant), find the
    // matching saved mock and hydrate mockReturns under the capability's
    // runtime name. This needs the spec to map capability id → name.
    const nextMockReturns: Record<string, Record<string, unknown>> = {};
    for (const [capId, variant] of Object.entries(mockBindings)) {
      const capability = spec_capabilities.find((c) => c.id === capId);
      if (!capability) continue;
      const mocks = mocksByCapability[capId] ?? [];
      const mock = mocks.find((m) => m.variant === variant) ?? mocks[0];
      if (!mock || mock.behavior.kind !== "static") continue;
      const returns = mock.behavior.returns;
      if (typeof returns !== "object" || returns === null) continue;
      nextMockReturns[capability.name] = returns as Record<string, unknown>;
    }
    if (Object.keys(nextMockReturns).length > 0) setMockReturns(nextMockReturns);

    // Bind the active case so the SimulatePanel can show the
    // Active-case header strip and the ▶ Run case button.
    setActiveCaseId(testCase.id);
    setOpenSimulateTab("simulate");
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-1.5">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-zinc-600 hover:text-zinc-900"
        >
          ‹ all cases
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-zinc-700"
            title="Save changes to this case."
          >
            Save
          </button>
          <button
            type="button"
            onClick={handleOpenInSimulate}
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
            title="Load this case's persona/mocks into the Simulate tab and switch to it."
          >
            Open in Sim ▶
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3 space-y-3 text-[11px]">
        <Section label="name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Human-readable label"
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          <div className="mt-1 text-[10px] text-zinc-500 font-mono">id: {testCase.id}</div>
        </Section>

        <Section label="source">
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={source === "scripted"}
                onChange={() => setSource("scripted")}
              />
              <span className="text-[11px]">scripted</span>
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={source === "persona"}
                onChange={() => setSource("persona")}
              />
              <span className="text-[11px]">persona-driven</span>
            </label>
          </div>

          {source === "scripted" && (
            <UserTurnsList turns={userTurns} onChange={setUserTurns} />
          )}

          {source === "persona" && (
            <div className="mt-2 space-y-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
                  persona
                </label>
                {personas.length === 0 ? (
                  <div className="text-[11px] text-zinc-500 italic">
                    No saved personas. Create one in the Personas tab.
                  </div>
                ) : (
                  <select
                    value={personaId}
                    onChange={(e) => setPersonaId(e.target.value)}
                    className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800"
                  >
                    <option value="">— pick a persona —</option>
                    {personas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
                  max_turns
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(parseInt(e.target.value, 10) || 1)}
                  className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800"
                />
              </div>
            </div>
          )}
        </Section>

        <Section label="mock these capabilities">
          {spec_capabilities.length === 0 ? (
            <div className="text-[11px] text-zinc-500 italic">
              No capabilities declared in the spec.
            </div>
          ) : (
            <ul className="space-y-1">
              {spec_capabilities.map((cap) => {
                const mocks = mocksByCapability[cap.id] ?? [];
                const bound = mockBindings[cap.id];
                const disabled = mocks.length === 0;
                return (
                  <li key={cap.id} className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={!!bound}
                        disabled={disabled}
                        onChange={(e) => {
                          if (e.target.checked) {
                            const variant = mocks[0]?.variant ?? "default";
                            setMockBindings({ ...mockBindings, [cap.id]: variant });
                          } else {
                            const next = { ...mockBindings };
                            delete next[cap.id];
                            setMockBindings(next);
                          }
                        }}
                      />
                      <span className="font-mono text-[11px] text-zinc-800 truncate">
                        {cap.id}
                      </span>
                    </label>
                    {disabled ? (
                      <span className="text-[10px] text-zinc-400 italic">no mocks</span>
                    ) : (
                      bound && <span className="text-[10px] text-zinc-500">{bound}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section label="assertions">
          <PerTurnAssertionList
            assertions={perTurnAssertions}
            onChange={setPerTurnAssertions}
          />
          <TranscriptAssertionList
            assertions={transcriptAssertions}
            onChange={setTranscriptAssertions}
          />
          <StateAssertionList
            assertions={stateAssertions}
            onChange={setStateAssertions}
          />
          <EvaluatorsList evaluators={evaluators} onChange={setEvaluators} />
        </Section>

        {referenceTranscript && (
          <Section label="reference transcript (read-only)">
            <div className="rounded border border-zinc-200 bg-zinc-50 p-2 space-y-1.5 max-h-64 overflow-auto">
              {referenceTranscript.map((t, i) => (
                <div key={i} className="text-[11px]">
                  <span
                    className={
                      t.role === "agent"
                        ? "font-mono text-[10px] text-emerald-700"
                        : "font-mono text-[10px] text-zinc-500"
                    }
                  >
                    {t.role}
                  </span>
                  <span className="ml-1.5 text-zinc-800 whitespace-pre-wrap">{t.text}</span>
                </div>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-zinc-500">
              Captured from the Simulate session that created this case.
            </div>
          </Section>
        )}

        <div className="pt-2 border-t border-zinc-200">
          <button
            type="button"
            onClick={handleDelete}
            className="rounded border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
          >
            Delete case
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      {children}
    </div>
  );
}

function UserTurnsList({
  turns,
  onChange,
}: {
  turns: string[];
  onChange: (turns: string[]) => void;
}) {
  function update(i: number, text: string) {
    onChange(turns.map((t, idx) => (idx === i ? text : t)));
  }
  function remove(i: number) {
    onChange(turns.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...turns, ""]);
  }
  return (
    <div className="mt-2 space-y-1.5">
      {turns.length === 0 && (
        <div className="text-[11px] text-zinc-500 italic">
          No user turns. Click + add to script one.
        </div>
      )}
      {turns.map((t, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="mt-1.5 w-4 text-right text-[10px] text-zinc-400">{i + 1}</span>
          <textarea
            value={t}
            onChange={(e) => update(i, e.target.value)}
            rows={1}
            className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800 resize-y"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="mt-1 rounded border border-zinc-200 bg-white px-1 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50"
            title="Remove turn"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
      >
        + add turn
      </button>
    </div>
  );
}

type PerTurn = NonNullable<TestCase["assertions"]>[number];

function PerTurnAssertionList({
  assertions,
  onChange,
}: {
  assertions: PerTurn[];
  onChange: (a: PerTurn[]) => void;
}) {
  function update(i: number, next: Partial<PerTurn>) {
    onChange(assertions.map((a, idx) => (idx === i ? { ...a, ...next } : a)));
  }
  function add() {
    onChange([...assertions, { turn: assertions.length + 1, must_contain: [""] }]);
  }
  function remove(i: number) {
    onChange(assertions.filter((_, idx) => idx !== i));
  }
  return (
    <SubSection label="per-turn substring">
      {assertions.map((a, i) => (
        <div
          key={i}
          className="rounded border border-zinc-200 bg-white p-2 space-y-1"
        >
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-zinc-500">turn</label>
            <input
              type="number"
              min={1}
              value={a.turn}
              onChange={(e) => update(i, { turn: parseInt(e.target.value, 10) || 1 })}
              className="w-12 rounded border border-zinc-300 px-1 py-0.5 text-[11px]"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="ml-auto rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50"
            >
              ✕
            </button>
          </div>
          <StringListEditor
            label="must_contain"
            values={a.must_contain ?? []}
            onChange={(v) => update(i, { must_contain: v.length === 0 ? undefined : v })}
          />
          <StringListEditor
            label="must_not_contain"
            values={a.must_not_contain ?? []}
            onChange={(v) =>
              update(i, { must_not_contain: v.length === 0 ? undefined : v })
            }
          />
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
      >
        + add per-turn assertion
      </button>
    </SubSection>
  );
}

type TranscriptAssn = NonNullable<TestCase["transcript_assertions"]>[number];

function TranscriptAssertionList({
  assertions,
  onChange,
}: {
  assertions: TranscriptAssn[];
  onChange: (a: TranscriptAssn[]) => void;
}) {
  function update(i: number, next: Partial<TranscriptAssn>) {
    onChange(assertions.map((a, idx) => (idx === i ? { ...a, ...next } : a)));
  }
  function add() {
    onChange([...assertions, { kind: "substring", pattern: "", must_appear: true }]);
  }
  function remove(i: number) {
    onChange(assertions.filter((_, idx) => idx !== i));
  }
  return (
    <SubSection label="transcript-level">
      {assertions.map((a, i) => (
        <div key={i} className="rounded border border-zinc-200 bg-white p-2 space-y-1">
          <div className="flex items-center gap-2">
            <select
              value={a.kind}
              onChange={(e) =>
                update(i, { kind: e.target.value as TranscriptAssn["kind"] })
              }
              className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-[11px]"
            >
              <option value="substring">substring</option>
              <option value="regex">regex</option>
              <option value="count">count</option>
              <option value="must_terminate_within">must_terminate_within</option>
            </select>
            <button
              type="button"
              onClick={() => remove(i)}
              className="ml-auto rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50"
            >
              ✕
            </button>
          </div>
          {(a.kind === "substring" || a.kind === "regex" || a.kind === "count") && (
            <input
              type="text"
              placeholder={a.kind === "regex" ? "regex (case-sensitive; (?i) for i)" : "pattern"}
              value={a.pattern ?? ""}
              onChange={(e) => update(i, { pattern: e.target.value })}
              className="w-full rounded border border-zinc-300 px-2 py-1 text-[11px]"
            />
          )}
          {(a.kind === "substring" || a.kind === "regex") && (
            <label className="flex items-center gap-1.5 text-[10px] text-zinc-700">
              <input
                type="checkbox"
                checked={a.must_appear ?? true}
                onChange={(e) => update(i, { must_appear: e.target.checked })}
              />
              must_appear
            </label>
          )}
          {a.kind === "count" && (
            <div className="flex items-center gap-2 text-[10px] text-zinc-700">
              <label className="flex items-center gap-1">
                min:
                <input
                  type="number"
                  min={0}
                  value={a.min_occurrences ?? ""}
                  onChange={(e) =>
                    update(i, {
                      min_occurrences:
                        e.target.value === "" ? undefined : parseInt(e.target.value, 10),
                    })
                  }
                  className="w-14 rounded border border-zinc-300 px-1 py-0.5 text-[11px]"
                />
              </label>
              <label className="flex items-center gap-1">
                max:
                <input
                  type="number"
                  min={0}
                  value={a.max_occurrences ?? ""}
                  onChange={(e) =>
                    update(i, {
                      max_occurrences:
                        e.target.value === "" ? undefined : parseInt(e.target.value, 10),
                    })
                  }
                  className="w-14 rounded border border-zinc-300 px-1 py-0.5 text-[11px]"
                />
              </label>
            </div>
          )}
          {a.kind === "must_terminate_within" && (
            <div className="flex items-center gap-1 text-[10px] text-zinc-700">
              max_turns:
              <input
                type="number"
                min={1}
                value={a.max_turns ?? ""}
                onChange={(e) =>
                  update(i, {
                    max_turns:
                      e.target.value === "" ? undefined : parseInt(e.target.value, 10),
                  })
                }
                className="w-14 rounded border border-zinc-300 px-1 py-0.5 text-[11px]"
              />
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
      >
        + add transcript-level assertion
      </button>
    </SubSection>
  );
}

type StateAssn = NonNullable<TestCase["state_assertions"]>[number];

function StateAssertionList({
  assertions,
  onChange,
}: {
  assertions: StateAssn[];
  onChange: (a: StateAssn[]) => void;
}) {
  function update(i: number, next: Partial<StateAssn>) {
    onChange(assertions.map((a, idx) => (idx === i ? { ...a, ...next } : a)));
  }
  function add() {
    onChange([...assertions, { variable: "", is_set: true }]);
  }
  function remove(i: number) {
    onChange(assertions.filter((_, idx) => idx !== i));
  }
  return (
    <SubSection
      label="state (needs runner — coming soon)"
      labelClassName="text-amber-700"
    >
      {assertions.map((a, i) => (
        <div key={i} className="rounded border border-zinc-200 bg-white p-2 space-y-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="variable name"
              value={a.variable}
              onChange={(e) => update(i, { variable: e.target.value })}
              className="flex-1 rounded border border-zinc-300 px-2 py-1 text-[11px] font-mono"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-zinc-700">
            <label className="flex items-center gap-1">
              equals:
              <input
                type="text"
                value={
                  a.equals === undefined ? "" : typeof a.equals === "string" ? a.equals : JSON.stringify(a.equals)
                }
                onChange={(e) =>
                  update(i, { equals: e.target.value === "" ? undefined : e.target.value })
                }
                className="w-32 rounded border border-zinc-300 px-1 py-0.5 text-[11px]"
              />
            </label>
            <label className="flex items-center gap-1">
              is_set:
              <input
                type="checkbox"
                checked={a.is_set ?? false}
                onChange={(e) => update(i, { is_set: e.target.checked })}
              />
            </label>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
      >
        + add state assertion
      </button>
    </SubSection>
  );
}

function EvaluatorsList({
  evaluators,
  onChange,
}: {
  evaluators: string[];
  onChange: (e: string[]) => void;
}) {
  return (
    <SubSection label="evaluators (rubric / py reference)">
      <StringListEditor label="" values={evaluators} onChange={onChange} />
    </SubSection>
  );
}

function StringListEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  function update(i: number, text: string) {
    onChange(values.map((v, idx) => (idx === i ? text : v)));
  }
  function remove(i: number) {
    onChange(values.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...values, ""]);
  }
  return (
    <div className="space-y-0.5">
      {label && <div className="text-[10px] text-zinc-500">{label}</div>}
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            value={v}
            onChange={(e) => update(i, e.target.value)}
            className="flex-1 rounded border border-zinc-300 px-2 py-0.5 text-[11px]"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
      >
        + add
      </button>
    </div>
  );
}

function SubSection({
  label,
  labelClassName,
  children,
}: {
  label: string;
  labelClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1 pt-2">
      <div className={`text-[10px] ${labelClassName ?? "text-zinc-500"}`}>{label}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
