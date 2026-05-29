import { useEffect, useMemo, useRef, useState } from "react";
import type { TestCase } from "@flowstore/core/schema/files/testCase";
import type { Rubric } from "@flowstore/core/schema/files/rubric";
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
  const saveCase = useTestsStore((s) => s.saveCase);
  const uniqueCaseId = useTestsStore((s) => s.uniqueCaseId);

  function startNew() {
    const defaultName = `Case ${cases.length + 1}`;
    const id = uniqueCaseId(defaultName);
    saveCase({
      $schema: "flowstore://test/case/v0",
      id,
      name: defaultName,
      user_turns: [],
    });
    onSelect(id);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
        <div className="text-[11px] text-zinc-500">
          {cases.length} {cases.length === 1 ? "case" : "cases"}
        </div>
        <button
          type="button"
          onClick={startNew}
          title="Create a new test case (rename + fill it in the editor). You can also capture from the Simulate tab."
          className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {cases.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-500">
            No test cases yet. Click{" "}
            <span className="font-medium">+ New</span> above, or capture a
            transcript from the Simulate tab.
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
                    <div className="truncate font-mono text-[10px] text-zinc-500">
                      {c.id} | {c.persona_id ? "persona" : "scripted"}
                    </div>
                  </div>
                  <span className="ml-2 text-zinc-400">▸</span>
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
  const casesCount = useTestsStore((s) => s.cases.length);
  const spec = useSpecStore((s) => s.spec);
  const simulateMode = useSimulateStore((s) => s.mode);
  const setPersonaPrompt = useSimulateStore((s) => s.setPersonaPrompt);
  const setMockReturns = useSimulateStore((s) => s.setMockReturns);
  const setActiveCaseId = useSimulateStore((s) => s.setActiveCaseId);
  const setSimulateLanguage = useSimulateStore((s) => s.setLanguage);
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
  const [perTurnRows, setPerTurnRows] = useState<PerTurnRow[]>(
    flattenPerTurn(testCase.assertions ?? []),
  );
  const [transcriptAssertions, setTranscriptAssertions] = useState(
    testCase.transcript_assertions ?? [],
  );
  const [stateAssertions, setStateAssertions] = useState(testCase.state_assertions ?? []);
  const [capabilityAssertions, setCapabilityAssertions] = useState(
    testCase.capability_assertions ?? [],
  );
  const [evaluators, setEvaluators] = useState<string[]>(testCase.evaluators ?? []);
  const [notes, setNotes] = useState(testCase.notes ?? "");
  const [goldId, setGoldId] = useState(testCase.gold_id ?? "");
  const [language, setLanguage] = useState(testCase.language ?? "");
  // vars_file is stored as a full project-relative path like
  // "tests/vars.bau.json"; the picker shows just the name (between
  // "tests/vars." and ".json"). Convert in/out at the boundary.
  const [varsFileName, setVarsFileName] = useState<string>(
    parseVarsFilePath(testCase.vars_file),
  );
  const golds = useTestsStore((s) => s.golds);
  const varsFiles = useTestsStore((s) => s.varsFiles);
  const setSimulateContextVars = useSimulateStore((s) => s.setContextVars);
  const availableLanguages = spec?.agent.meta.languages ?? [];
  const showLanguage = availableLanguages.length > 1;

  // Re-hydrate draft when the selected case identity changes.
  useEffect(() => {
    setName(testCase.name ?? "");
    setSource(testCase.persona_id ? "persona" : "scripted");
    setUserTurns(testCase.user_turns ?? []);
    setPersonaId(testCase.persona_id ?? "");
    setMockBindings(testCase.mock_bindings ?? {});
    setPerTurnRows(flattenPerTurn(testCase.assertions ?? []));
    setTranscriptAssertions(testCase.transcript_assertions ?? []);
    setStateAssertions(testCase.state_assertions ?? []);
    setCapabilityAssertions(testCase.capability_assertions ?? []);
    setEvaluators(testCase.evaluators ?? []);
    setNotes(testCase.notes ?? "");
    setGoldId(testCase.gold_id ?? "");
    setLanguage(testCase.language ?? "");
    setVarsFileName(parseVarsFilePath(testCase.vars_file));
  }, [testCase.id]);

  const spec_capabilities = useMemo(() => spec?.agent.capabilities ?? [], [spec]);
  const referenceTranscript =
    captureContext && captureContext.caseId === testCase.id
      ? captureContext.transcript
      : null;

  // Dirty = any editable field diverged from the saved record. Matches
  // the persona-row pattern so the Save button greys out after a save
  // (testCase prop updates → draft already matches → dirty becomes false).
  // JSON.stringify is good enough for the small case shape; saves writing
  // a deep-equal helper.
  const dirty =
    name !== (testCase.name ?? "") ||
    (source === "persona") !== (testCase.persona_id !== undefined && testCase.persona_id !== "") ||
    JSON.stringify(userTurns) !== JSON.stringify(testCase.user_turns ?? []) ||
    personaId !== (testCase.persona_id ?? "") ||
    JSON.stringify(mockBindings) !== JSON.stringify(testCase.mock_bindings ?? {}) ||
    JSON.stringify(groupPerTurn(perTurnRows)) !==
      JSON.stringify(testCase.assertions ?? []) ||
    JSON.stringify(transcriptAssertions) !==
      JSON.stringify(testCase.transcript_assertions ?? []) ||
    JSON.stringify(stateAssertions) !==
      JSON.stringify(testCase.state_assertions ?? []) ||
    JSON.stringify(capabilityAssertions) !==
      JSON.stringify(testCase.capability_assertions ?? []) ||
    JSON.stringify(evaluators) !== JSON.stringify(testCase.evaluators ?? []) ||
    notes !== (testCase.notes ?? "") ||
    goldId !== (testCase.gold_id ?? "") ||
    language !== (testCase.language ?? "") ||
    varsFileName !== parseVarsFilePath(testCase.vars_file);

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
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(goldId ? { gold_id: goldId } : {}),
      ...(varsFileName ? { vars_file: `tests/vars.${varsFileName}.json` } : {}),
      ...(showLanguage && language ? { language } : {}),
      ...(Object.keys(mockBindings).length > 0 ? { mock_bindings: mockBindings } : {}),
      ...(perTurnRows.length > 0 ? { assertions: groupPerTurn(perTurnRows) } : {}),
      ...(transcriptAssertions.length > 0
        ? { transcript_assertions: transcriptAssertions }
        : {}),
      ...(stateAssertions.length > 0 ? { state_assertions: stateAssertions } : {}),
      ...(capabilityAssertions.length > 0
        ? { capability_assertions: capabilityAssertions }
        : {}),
      ...(evaluators.length > 0 ? { evaluators } : {}),
      // Preserve fields the editor doesn't surface (per the planning doc:
      // vars_file / model / tags stay in the schema but not in the form).
      // language is preserved when not editable (monolingual project).
      ...(testCase.model !== undefined ? { model: testCase.model } : {}),
      ...(!showLanguage && testCase.language !== undefined
        ? { language: testCase.language }
        : {}),
      ...(testCase.tags !== undefined ? { tags: testCase.tags } : {}),
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

    // Override Simulate's language picker with the case's language
    // (when set). Cases are intrinsically scoped to a language for
    // multilingual specs; opening one should match.
    if (language) setSimulateLanguage(language);

    // Load the case's vars file into Simulate's contextVars (when set).
    // vars files are shared resources; the case's binding is just a
    // reference. Resolve by stripping the "tests/vars." and ".json" to
    // get the store key.
    if (varsFileName && varsFiles[varsFileName]) {
      setSimulateContextVars(varsFiles[varsFileName]);
    }

    // Bind the active case so the SimulatePanel can show the
    // Active-case header strip and the ▶ Run case button.
    setActiveCaseId(testCase.id);
    setOpenSimulateTab("simulate");
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-1.5">
        <div className="text-[11px] text-zinc-500">
          {casesCount} {casesCount === 1 ? "case" : "cases"}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty}
            className="rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            title={dirty ? "Save changes to this case." : "No unsaved edits."}
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

      <button
        type="button"
        onClick={onBack}
        title="Click to collapse back to the case list."
        className="flex w-full items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-zinc-900">
            {testCase.name || testCase.id}
          </div>
          <div className="truncate font-mono text-[10px] text-zinc-500">
            {testCase.id} | {testCase.persona_id ? "persona" : "scripted"}
          </div>
        </div>
        <span className="ml-2 text-zinc-400">▾</span>
      </button>

      <div className="flex-1 overflow-auto px-3 py-3 space-y-5 text-[11px]">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
            name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Human-readable label"
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
            notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What does this case test?"
            rows={2}
            className="w-full resize-y rounded border border-zinc-300 bg-white p-1.5 text-[11px] leading-snug text-zinc-800"
          />
        </div>

        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
              gold
            </label>
            <select
              value={goldId}
              onChange={(e) => setGoldId(e.target.value)}
              className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700"
              title="Reference gold transcript for {gold_standard} substitution in rubric judging."
            >
              <option value="">— none —</option>
              {golds.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name || g.id}
                </option>
              ))}
            </select>
          </div>

          {showLanguage && (
            <div className="w-24 shrink-0">
              <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
                language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700"
                title="Language code to scope this case's scripts/FAQ. Overrides the Simulate-tab language picker on Open in Sim."
              >
                <option value="">— all —</option>
                {availableLanguages.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
            vars
          </label>
          <select
            value={varsFileName}
            onChange={(e) => setVarsFileName(e.target.value)}
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700"
            title="Vars file injected into Simulate's contextVars on Open in Sim. Sourced from tests/vars.<name>.json."
          >
            <option value="">— none —</option>
            {Object.keys(varsFiles)
              .sort()
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
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
                  <li key={cap.id} className="flex items-center gap-1.5">
                    <span className="flex-1 min-w-0 font-mono text-[11px] text-zinc-800 truncate">
                      {cap.id}
                    </span>
                    {disabled ? (
                      <span className="text-[10px] text-zinc-400 italic">no mocks</span>
                    ) : (
                      <select
                        value={bound ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "") {
                            const next = { ...mockBindings };
                            delete next[cap.id];
                            setMockBindings(next);
                          } else {
                            setMockBindings({ ...mockBindings, [cap.id]: v });
                          }
                        }}
                        className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-[10px] font-mono text-zinc-700"
                        title="Pick which mock variant fires for this capability when the case runs. Leave blank to call the real capability."
                      >
                        <option value="">—</option>
                        {mocks.map((m) => (
                          <option key={m.variant} value={m.variant}>
                            {m.variant}
                            {m.behavior.kind === "error" ? " (error)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        <Section label="assertions">
          <PerTurnAssertionList rows={perTurnRows} onChange={setPerTurnRows} />
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
          <CapabilityAssertionList
            assertions={capabilityAssertions}
            onChange={setCapabilityAssertions}
            capabilities={spec_capabilities}
          />
        </Section>

        <Section label="evaluators">
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

// vars_file in the case schema is a full project-relative path
// ("tests/vars.bau.json"); the editor's picker uses just the name
// ("bau") to look up varsFiles[name]. Strip the prefix and suffix.
function parseVarsFilePath(path: string | undefined): string {
  if (!path) return "";
  const match = /^tests\/vars\.(.+)\.json$/.exec(path);
  return match ? match[1] : "";
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="space-y-3">{children}</div>
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

// Editor-side flat shape. The schema groups must_contain[] /
// must_not_contain[] under a single turn; the editor lets the user
// add one substring per row instead — easier to scan and reorder.
// flattenPerTurn / groupPerTurn round-trip between the two.
interface PerTurnRow {
  turn: number;
  op: "contains" | "doesnt_contain";
  text: string;
}

function flattenPerTurn(assertions: PerTurn[]): PerTurnRow[] {
  const rows: PerTurnRow[] = [];
  for (const a of assertions) {
    for (const t of a.must_contain ?? []) {
      rows.push({ turn: a.turn, op: "contains", text: t });
    }
    for (const t of a.must_not_contain ?? []) {
      rows.push({ turn: a.turn, op: "doesnt_contain", text: t });
    }
  }
  rows.sort((a, b) => a.turn - b.turn);
  return rows;
}

function groupPerTurn(rows: PerTurnRow[]): PerTurn[] {
  const byTurn = new Map<number, { must_contain: string[]; must_not_contain: string[] }>();
  for (const r of rows) {
    if (r.text.trim() === "") continue;
    let entry = byTurn.get(r.turn);
    if (!entry) {
      entry = { must_contain: [], must_not_contain: [] };
      byTurn.set(r.turn, entry);
    }
    if (r.op === "contains") entry.must_contain.push(r.text);
    else entry.must_not_contain.push(r.text);
  }
  return Array.from(byTurn.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([turn, lists]) => ({
      turn,
      ...(lists.must_contain.length > 0 ? { must_contain: lists.must_contain } : {}),
      ...(lists.must_not_contain.length > 0 ? { must_not_contain: lists.must_not_contain } : {}),
    }));
}

function PerTurnAssertionList({
  rows,
  onChange,
}: {
  rows: PerTurnRow[];
  onChange: (r: PerTurnRow[]) => void;
}) {
  function update(i: number, next: Partial<PerTurnRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...next } : r)));
  }
  function add() {
    const lastTurn = rows[rows.length - 1]?.turn ?? 1;
    onChange([...rows, { turn: lastTurn, op: "contains", text: "" }]);
  }
  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  return (
    <SubSection label="per-turn">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="text-[10px] text-zinc-500">t</span>
          <input
            type="number"
            min={1}
            value={r.turn}
            onChange={(e) => update(i, { turn: parseInt(e.target.value, 10) || 1 })}
            className="w-10 rounded border border-zinc-300 px-1 py-0.5 text-[11px]"
            title="Agent turn index (1 = first agent turn)."
          />
          <select
            value={r.op}
            onChange={(e) =>
              update(i, { op: e.target.value as PerTurnRow["op"] })
            }
            className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-[11px] text-zinc-700"
          >
            <option value="contains">contains</option>
            <option value="doesnt_contain">doesn't contain</option>
          </select>
          <input
            type="text"
            value={r.text}
            onChange={(e) => update(i, { text: e.target.value })}
            placeholder="substring"
            className="flex-1 min-w-0 rounded border border-zinc-300 px-2 py-0.5 text-[11px]"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50"
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
        <div key={i} className="flex items-center gap-1">
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
            <option value="must_terminate_within">terminate</option>
          </select>
          {(a.kind === "substring" || a.kind === "regex" || a.kind === "count") && (
            <input
              type="text"
              placeholder={a.kind === "regex" ? "regex (case-insensitive)" : "pattern"}
              value={a.pattern ?? ""}
              onChange={(e) => update(i, { pattern: e.target.value })}
              className="flex-1 min-w-0 rounded border border-zinc-300 px-2 py-0.5 text-[11px]"
            />
          )}
          {(a.kind === "substring" || a.kind === "regex") && (
            <select
              value={a.must_appear === false ? "false" : "true"}
              onChange={(e) => update(i, { must_appear: e.target.value === "true" })}
              title="Whether the pattern should appear at least once in the agent's combined transcript."
              className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-[11px] text-zinc-700"
            >
              <option value="true">should appear</option>
              <option value="false">should not</option>
            </select>
          )}
          {a.kind === "count" && (
            <>
              <input
                type="number"
                min={0}
                placeholder="min"
                value={a.min_occurrences ?? ""}
                onChange={(e) =>
                  update(i, {
                    min_occurrences:
                      e.target.value === "" ? undefined : parseInt(e.target.value, 10),
                  })
                }
                title="Minimum occurrences"
                className="w-12 rounded border border-zinc-300 px-1 py-0.5 text-[11px]"
              />
              <input
                type="number"
                min={0}
                placeholder="max"
                value={a.max_occurrences ?? ""}
                onChange={(e) =>
                  update(i, {
                    max_occurrences:
                      e.target.value === "" ? undefined : parseInt(e.target.value, 10),
                  })
                }
                title="Maximum occurrences"
                className="w-12 rounded border border-zinc-300 px-1 py-0.5 text-[11px]"
              />
            </>
          )}
          {a.kind === "must_terminate_within" && (
            <input
              type="number"
              min={1}
              placeholder="max agent turns"
              value={a.max_turns ?? ""}
              onChange={(e) =>
                update(i, {
                  max_turns:
                    e.target.value === "" ? undefined : parseInt(e.target.value, 10),
                })
              }
              title="Fail if the agent produces more than this many turns."
              className="flex-1 min-w-0 rounded border border-zinc-300 px-2 py-0.5 text-[11px]"
            />
          )}
          <button
            type="button"
            onClick={() => remove(i)}
            className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50"
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

type CapAssn = NonNullable<TestCase["capability_assertions"]>[number];

function CapabilityAssertionList({
  assertions,
  onChange,
  capabilities,
}: {
  assertions: CapAssn[];
  onChange: (a: CapAssn[]) => void;
  capabilities: { id: string; name: string }[];
}) {
  function update(i: number, next: Partial<CapAssn>) {
    onChange(assertions.map((a, idx) => (idx === i ? { ...a, ...next } : a)));
  }
  function add() {
    onChange([
      ...assertions,
      { capability: capabilities[0]?.id ?? "", invoked: true },
    ]);
  }
  function remove(i: number) {
    onChange(assertions.filter((_, idx) => idx !== i));
  }
  if (capabilities.length === 0 && assertions.length === 0) return null;
  return (
    <SubSection label="capability">
      {assertions.map((a, i) => (
        <div key={i} className="flex items-center gap-1">
          <select
            value={a.capability}
            onChange={(e) => update(i, { capability: e.target.value })}
            className="flex-1 min-w-0 rounded border border-zinc-300 bg-white px-1 py-0.5 text-[11px] font-mono text-zinc-700"
          >
            {capabilities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
            {/* keep an unknown id selectable so the row doesn't lose its value */}
            {!capabilities.some((c) => c.id === a.capability) && a.capability && (
              <option value={a.capability}>{a.capability} (unknown)</option>
            )}
          </select>
          <select
            value={a.invoked === false ? "false" : "true"}
            onChange={(e) => update(i, { invoked: e.target.value === "true" })}
            title="Whether the capability should be invoked at least once during the run."
            className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-[11px] text-zinc-700"
          >
            <option value="true">invoked</option>
            <option value="false">not invoked</option>
          </select>
          <button
            type="button"
            onClick={() => remove(i)}
            className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        disabled={capabilities.length === 0}
        className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
      >
        + add capability assertion
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
  rubrics: Rubric[];
  onChange: (e: string[]) => void;
}) {
  const saveRubric = useTestsStore((s) => s.saveRubric);
  const deleteRubric = useTestsStore((s) => s.deleteRubric);
  const uniqueRubricId = useTestsStore((s) => s.uniqueRubricId);
  const allCases = useTestsStore((s) => s.cases);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
  function addNewRubric() {
    const defaultName = `Rubric ${rubrics.length + 1}`;
    const id = uniqueRubricId(defaultName);
    saveRubric({
      $schema: "flowstore://test/rubric/v0",
      id,
      name: defaultName,
      criteria: "",
      scale: { min: 1, max: 5 },
      prompt_template:
        "Evaluate the following transcript against the criteria.\n\n" +
        "Criteria: {criteria}\n\nTranscript:\n{transcript}\n\n" +
        "Return a JSON object with `score` (integer 1-5) and `notes` " +
        "(one-sentence explanation citing the specific turn(s) that drove " +
        "the score; turn 1 is the agent's first message).",
    });
    onChange([...evaluators, id]);
    setExpandedId(id);
  }

  return (
    <div className="space-y-1">
        {evaluators.map((v, i) => {
          const rubric = rubrics.find((r) => r.id === v);
          const primary = rubric?.name || v;
          const isExpanded = expandedId === v;
          return (
            <div key={i} className="rounded border border-zinc-200 bg-white">
              <div className="flex items-center gap-1 px-2 py-0.5">
                <button
                  type="button"
                  onClick={() => rubric && setExpandedId(isExpanded ? null : v)}
                  disabled={!rubric}
                  className="flex-1 min-w-0 text-left"
                  title={
                    rubric
                      ? "Edit rubric inline"
                      : "Custom evaluator name — resolves to tests/evaluators/<name>.py (hand-authored)"
                  }
                >
                  <div className="flex items-center gap-1">
                    {rubric && (
                      <span className="text-zinc-400 text-[10px]">
                        {isExpanded ? "▾" : "▸"}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-zinc-800">{primary}</div>
                      {rubric?.name && rubric.name !== v && (
                        <div className="truncate font-mono text-[10px] text-zinc-500">
                          {v}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50"
                >
                  ✕
                </button>
              </div>
              {isExpanded && rubric && (
                <RubricInlineEditor
                  rubric={rubric}
                  cases={allCases}
                  onSave={saveRubric}
                  onDelete={(id) => {
                    deleteRubric(id);
                    // The store-level cascade strips this id from every
                    // case's evaluators[], but the editor's local draft
                    // for the currently-open case is a separate copy —
                    // strip the id here too so the next Save doesn't
                    // re-introduce the orphaned reference.
                    onChange(evaluators.filter((e) => e !== id));
                    setExpandedId(null);
                  }}
                />
              )}
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          <select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              addRubric(v);
            }}
            disabled={available.length === 0}
            className="flex-1 min-w-0 rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 disabled:opacity-40"
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
                  {r?.name || id}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            onClick={addNewRubric}
            title="Create a new rubric and bind it. The inline editor opens — set criteria + prompt template right here."
            className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50 whitespace-nowrap"
          >
            + new
          </button>
        </div>
    </div>
  );
}

function RubricInlineEditor({
  rubric,
  cases,
  onSave,
  onDelete,
}: {
  rubric: Rubric;
  cases: TestCase[];
  onSave: (r: Rubric) => void;
  onDelete: (id: string) => void;
}) {
  // Local draft so the user can edit without dirtying every keystroke
  // (saveRubric marks the project dirty). Save commits the draft. Scale
  // is hidden from the editor and pinned to 1-5 — the prompt_template
  // bakes that range in literally.
  const [name, setName] = useState(rubric.name ?? "");
  const [criteria, setCriteria] = useState(rubric.criteria);
  const [promptTemplate, setPromptTemplate] = useState(rubric.prompt_template);

  useEffect(() => {
    setName(rubric.name ?? "");
    setCriteria(rubric.criteria);
    setPromptTemplate(rubric.prompt_template);
  }, [rubric.id]);

  const dirty =
    name !== (rubric.name ?? "") ||
    criteria !== rubric.criteria ||
    promptTemplate !== rubric.prompt_template;

  function handleSave() {
    onSave({
      $schema: "flowstore://test/rubric/v0",
      id: rubric.id,
      ...(name.trim() ? { name: name.trim() } : {}),
      criteria,
      // Preserve any non-1-5 scale that came from a JSON-side edit.
      scale: rubric.scale,
      prompt_template: promptTemplate,
      ...(rubric.model !== undefined ? { model: rubric.model } : {}),
    });
  }

  function handleDelete() {
    const referencingCases = cases.filter((c) =>
      (c.evaluators ?? []).includes(rubric.id),
    );
    const refMsg =
      referencingCases.length > 0
        ? `\n\n${referencingCases.length} case${referencingCases.length === 1 ? "" : "s"} still reference${referencingCases.length === 1 ? "s" : ""} this rubric (binding stays until you unbind manually).`
        : "";
    const ok = window.confirm(
      `Delete rubric "${rubric.name || rubric.id}"?${refMsg}`,
    );
    if (!ok) return;
    onDelete(rubric.id);
  }

  return (
    <div className="space-y-1.5 border-t border-zinc-100 bg-zinc-50/60 p-2">
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
          name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px]"
        />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
          criteria
        </label>
        <textarea
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          rows={2}
          placeholder="What the judge should check for."
          className="w-full resize-y rounded border border-zinc-300 bg-white p-1.5 text-[11px] leading-snug"
        />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
          prompt_template
        </label>
        <textarea
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          rows={5}
          placeholder="LLM-judge prompt. Placeholders: {transcript}, {criteria}, {gold_standard}."
          className="w-full resize-y rounded border border-zinc-300 bg-white p-1.5 font-mono text-[10px] leading-snug"
        />
      </div>
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={handleDelete}
          className="rounded border border-red-300 bg-white px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-50"
        >
          Delete rubric
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty}
          className="rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
        >
          Save rubric
        </button>
      </div>
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
    <div className="space-y-1">
      <div className={`text-[10px] ${labelClassName ?? "text-zinc-500"}`}>{label}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
