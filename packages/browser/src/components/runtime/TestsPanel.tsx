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
  const setOpenSimulateTab = useUiStore((s) => s.setOpenSimulateTab);
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
        <div className="text-[11px] text-zinc-500">
          {cases.length} {cases.length === 1 ? "case" : "cases"}
        </div>
        <button
          type="button"
          onClick={() => setOpenSimulateTab("simulate")}
          title="Switch to Simulate, play a conversation, and use the capture button to save it as a test case."
          className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
        >
          capture from Simulate
        </button>
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
  const rubrics = useTestsStore((s) => s.rubrics);
  const mocksByCapability = useTestsStore((s) => s.mocksByCapability);
  const captureContext = useTestsStore((s) => s.captureContext);
  const spec = useSpecStore((s) => s.spec);
  const simulateMode = useSimulateStore((s) => s.mode);
  const setPersonaPrompt = useSimulateStore((s) => s.setPersonaPrompt);
  const setMockReturns = useSimulateStore((s) => s.setMockReturns);
  const setActiveCaseId = useSimulateStore((s) => s.setActiveCaseId);
  const setOpenSimulateTab = useUiStore((s) => s.setOpenSimulateTab);
  // State assertions only fire on the runner path. Hide the entire
  // sub-section unless mode === "runner" — the runner-mode toggle in
  // SimulatePanel is itself gated on a configured runner URL, so the
  // mode alone is a sufficient proxy.
  const stateAssertionsAvailable = simulateMode === "runner";

  // Draft state mirrors the saved record; Save commits the draft into the
  // store, which dirties the project for the next GitHub Save.
  const [name, setName] = useState(testCase.name ?? "");
  const [source, setSource] = useState<"scripted" | "persona">(
    testCase.persona_id ? "persona" : "scripted",
  );
  const [userTurns, setUserTurns] = useState<string[]>(testCase.user_turns ?? []);
  const [personaId, setPersonaId] = useState(testCase.persona_id ?? "");
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
        ? {
            persona_id: personaId,
            // max_turns is controlled from the Simulate panel
            // (personaTurnLimit) at run time; preserve any pre-existing
            // value in the case file but don't surface in the editor.
            ...(testCase.max_turns !== undefined ? { max_turns: testCase.max_turns } : {}),
          }
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
        <div>
          <div className="flex items-baseline justify-between">
            <label className="text-[10px] uppercase tracking-wide text-zinc-500">
              name
            </label>
            <span className="font-mono text-[10px] text-zinc-400" title="ID is the filename.">
              id: {testCase.id}
            </span>
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Human-readable label"
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </div>

        <div>
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
            <div className="mt-2">
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
          )}
        </div>

        {spec_capabilities.length > 0 && (
          <Section label="mock these capabilities">
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
          </Section>
        )}

        <Section label="assertions">
          <PerTurnAssertionList
            assertions={perTurnAssertions}
            onChange={setPerTurnAssertions}
          />
          <TranscriptAssertionList
            assertions={transcriptAssertions}
            onChange={setTranscriptAssertions}
          />
          {stateAssertionsAvailable && (
            <StateAssertionList
              assertions={stateAssertions}
              onChange={setStateAssertions}
            />
          )}
          <EvaluatorsList
            evaluators={evaluators}
            rubrics={rubrics}
            onChange={setEvaluators}
          />
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
            <select
              value={a.must_appear === false ? "false" : "true"}
              onChange={(e) =>
                update(i, { must_appear: e.target.value === "true" })
              }
              title="Whether the pattern should appear at least once in the agent's combined transcript."
              className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-[11px] text-zinc-700"
            >
              <option value="true">should appear</option>
              <option value="false">should not appear</option>
            </select>
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

// Operator kinds for state assertions. Schema says exactly one of
// equals/matches/is_set must be set; we model that as a single select
// instead of three separate inputs the user has to reason about. The
// "must_be_set" / "must_be_unset" operators just store the
// corresponding boolean to `is_set`.
type StateOperator = "equals" | "matches" | "must_be_set" | "must_be_unset";

function operatorOf(a: StateAssn): StateOperator {
  if (a.equals !== undefined) return "equals";
  if (a.matches !== undefined) return "matches";
  if (a.is_set === false) return "must_be_unset";
  return "must_be_set";
}

function StateAssertionList({
  assertions,
  onChange,
}: {
  assertions: StateAssn[];
  onChange: (a: StateAssn[]) => void;
}) {
  function update(i: number, next: StateAssn) {
    onChange(assertions.map((a, idx) => (idx === i ? next : a)));
  }
  function add() {
    onChange([...assertions, { variable: "", is_set: true }]);
  }
  function remove(i: number) {
    onChange(assertions.filter((_, idx) => idx !== i));
  }
  return (
    <SubSection label="state">
      {assertions.map((a, i) => {
        const op = operatorOf(a);
        return (
          <div key={i} className="rounded border border-zinc-200 bg-white p-2 space-y-1">
            <div className="flex items-center gap-1">
              <input
                type="text"
                placeholder="variable name"
                value={a.variable}
                onChange={(e) => update(i, { ...a, variable: e.target.value })}
                className="flex-1 rounded border border-zinc-300 px-2 py-1 text-[11px] font-mono"
              />
              <select
                value={op}
                onChange={(e) => {
                  const next = e.target.value as StateOperator;
                  if (next === "must_be_set") {
                    update(i, { variable: a.variable, is_set: true });
                  } else if (next === "must_be_unset") {
                    update(i, { variable: a.variable, is_set: false });
                  } else if (next === "equals") {
                    update(i, { variable: a.variable, equals: "" });
                  } else {
                    update(i, { variable: a.variable, matches: "" });
                  }
                }}
                title={
                  op === "must_be_set"
                    ? "Variable must be bound to any non-null value at run end."
                    : op === "must_be_unset"
                      ? "Variable must be absent or bound to null at run end."
                      : op === "equals"
                        ? "Strict equality (Python ==) against the operand."
                        : "Regex match against str(value)."
                }
                className="rounded border border-zinc-300 bg-white px-1 py-1 text-[11px] text-zinc-700"
              >
                <option value="must_be_set">must be set</option>
                <option value="must_be_unset">must be unset</option>
                <option value="equals">equals</option>
                <option value="matches">matches</option>
              </select>
              <button
                type="button"
                onClick={() => remove(i)}
                className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50"
              >
                ✕
              </button>
            </div>
            {(op === "equals" || op === "matches") && (
              <input
                type="text"
                placeholder={op === "matches" ? "regex" : "value"}
                value={
                  op === "equals"
                    ? typeof a.equals === "string"
                      ? a.equals
                      : a.equals === undefined
                        ? ""
                        : JSON.stringify(a.equals)
                    : a.matches ?? ""
                }
                onChange={(e) => {
                  if (op === "equals") {
                    update(i, { variable: a.variable, equals: e.target.value });
                  } else {
                    update(i, { variable: a.variable, matches: e.target.value });
                  }
                }}
                className="w-full rounded border border-zinc-300 px-2 py-1 text-[11px]"
              />
            )}
          </div>
        );
      })}
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
  rubrics,
  onChange,
}: {
  evaluators: string[];
  rubrics: { id: string; name?: string }[];
  onChange: (e: string[]) => void;
}) {
  // Available rubric ids that aren't already bound to this case.
  const available = rubrics
    .map((r) => r.id)
    .filter((id) => !evaluators.includes(id));

  function remove(i: number) {
    onChange(evaluators.filter((_, idx) => idx !== i));
  }
  function addRubric(id: string) {
    if (id === "" || evaluators.includes(id)) return;
    onChange([...evaluators, id]);
  }
  function addCustom() {
    const name = window.prompt(
      "Evaluator name (resolves to tests/rubrics/<name>.rubric.json or tests/evaluators/<name>.py):",
      "",
    )?.trim();
    if (!name) return;
    onChange([...evaluators, name]);
  }
  return (
    <SubSection label="evaluators">
      <div className="space-y-1">
        {evaluators.length === 0 && (
          <div className="text-[10px] text-zinc-500 italic">
            None bound. Pick a rubric below or add a custom evaluator name.
          </div>
        )}
        {evaluators.map((v, i) => {
          const rubric = rubrics.find((r) => r.id === v);
          return (
            <div
              key={i}
              className="flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-0.5"
            >
              <span className="font-mono text-[11px] text-zinc-800 flex-1 truncate">
                {v}
              </span>
              {rubric?.name && (
                <span className="text-[10px] text-zinc-500 truncate">
                  {rubric.name}
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50"
              >
                ✕
              </button>
            </div>
          );
        })}
        <div className="flex items-center gap-1 pt-0.5">
          <select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              addRubric(v);
            }}
            disabled={available.length === 0}
            className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 disabled:opacity-40"
          >
            <option value="">
              {available.length === 0
                ? rubrics.length === 0
                  ? "no saved rubrics"
                  : "all rubrics bound"
                : "+ pick rubric"}
            </option>
            {available.map((id) => {
              const r = rubrics.find((rr) => rr.id === id);
              return (
                <option key={id} value={id}>
                  {id}
                  {r?.name ? ` — ${r.name}` : ""}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            onClick={addCustom}
            className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
          >
            + custom
          </button>
        </div>
      </div>
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
