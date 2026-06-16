import { useEffect, useMemo, useRef, useState } from "react";
import type { TestCase } from "@flowstore/core/schema/files/testCase";
import type { Rubric } from "@flowstore/core/schema/files/rubric";
import type { MockBehavior } from "@flowstore/core/schema/files/mockBehavior";
import { useTestsStore } from "@/lib/store/tests";
import { useSpecStore } from "@/lib/store/spec";
import { useSimulateStore } from "@/lib/store/simulate";
import { useUiStore } from "@/lib/store/ui";
import { caseWorldToRuntime } from "@flowstore/core/runtime/personaRuntime";
import { collectDeclaredVariables } from "@flowstore/core/runtime/contextVars";
import { collectMockableCapabilities } from "@flowstore/core/runtime/capabilityMocks";
import { VarsEditor } from "./persona/VarsEditor";
import { MocksEditor } from "./persona/MocksEditor";

type Actor = "scripted" | "persona" | "inline";
type UserTurn = NonNullable<TestCase["user_turns"]>[number];

// One-line descriptions for the vendored built-in Python evaluators, so a name
// like "tool_calls_check" isn't opaque in the list. Names not here fall back to
// a generic "Python evaluator" label.
const BUILTIN_EVALUATORS: Record<string, string> = {
  tool_calls_check: "every tool call is well-formed against the spec",
  forbidden_phrases: "fails if a forbidden phrase appears",
  required_phrases: "fails unless each required phrase appears",
  max_turn_length: "flags agent turns over the length budget",
  regex_match: "checks the transcript against a regex",
  state_check: "asserts final variable values",
};

// Tests-tab case library + editor. List view by default; click a row to
// land in the editor view (Personas-tab tried inline expand, but Tests
// has too many sections for that to read well in 380px). Save persists
// to useTestsStore (which dirties the project for the next GitHub Save).
// Open in Sim ▶ loads the case's persona/mocks into Simulate and switches
// to the Simulate tab — the live-verdicts surface lands in step 6.

export function TestsPanel() {
  const cases = useTestsStore((s) => s.cases);
  const saveCase = useTestsStore((s) => s.saveCase);
  const uniqueCaseId = useTestsStore((s) => s.uniqueCaseId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Shared by the list header and the editor header so "+ New" is always
  // reachable — matching the inline-expand panels, where the list (and its
  // + New) never disappears behind an editor.
  function createCase() {
    const defaultName = `Case ${cases.length + 1}`;
    const id = uniqueCaseId(defaultName);
    saveCase({
      $schema: "flowstore://test/case/v0",
      id,
      name: defaultName,
      user_turns: [],
    });
    setSelectedId(id);
  }

  // Auto-open the editor for a newly created case (capture from Simulate
  // or "Create Test" from a gold). Clear after handling so navigating
  // back to the list doesn't re-enter the editor on re-render.
  const pendingCaseId = useTestsStore((s) => s.pendingCaseId);
  const setPendingCaseId = useTestsStore((s) => s.setPendingCaseId);
  const handledPendingRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      pendingCaseId &&
      pendingCaseId !== handledPendingRef.current &&
      cases.some((c) => c.id === pendingCaseId)
    ) {
      setSelectedId(pendingCaseId);
      handledPendingRef.current = pendingCaseId;
      setPendingCaseId(null);
    }
  }, [pendingCaseId, cases, setPendingCaseId]);

  const selected = selectedId ? cases.find((c) => c.id === selectedId) ?? null : null;

  if (selected) {
    return (
      <CaseEditor
        testCase={selected}
        onBack={() => setSelectedId(null)}
        onNew={createCase}
      />
    );
  }

  return <CaseList cases={cases} onSelect={(id) => setSelectedId(id)} onNew={createCase} />;
}

function CaseList({
  cases,
  onSelect,
  onNew,
}: {
  cases: TestCase[];
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
        <div className="text-[11px] text-zinc-500">
          {cases.length} {cases.length === 1 ? "case" : "cases"}
        </div>
        <button
          type="button"
          onClick={onNew}
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
                      {c.id} | {actorOf(c)}
                    </div>
                    <CaseTags tags={c.tags} />
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

// Tags surfaced as chips on each case row. Namespace-aware styling only:
// `flow:<id>` tags get a tint (the lightweight convention for associating a
// case with the flow(s) it exercises — see testCase.ts), bare scenario tags
// (happy / negotiation / safety …) are neutral, and `src:*` provenance is
// hidden here (bookkeeping, not useful at-a-glance). No spec lookup or
// staleness check — that waits for flow maps.
function CaseTags({ tags }: { tags: string[] | undefined }) {
  if (!tags?.length) return null;
  const shown = tags.filter((t) => !t.startsWith("src:"));
  if (shown.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {shown.map((t) => {
        const isFlow = t.startsWith("flow:");
        return (
          <span
            key={t}
            title={t}
            className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
              isFlow ? "bg-indigo-100 text-indigo-700" : "bg-zinc-100 text-zinc-600"
            }`}
          >
            {isFlow ? t.slice("flow:".length) : t}
          </span>
        );
      })}
    </div>
  );
}

// Minimal tags editor: add/remove chips + a native <datalist> that autocompletes
// from the existing library vocabulary (and flow:<id> per spec flow). flow: chips
// get a tint; everything else is neutral. No validation — a flow: tag is just a
// string until flow maps make it precise.
function TagsField({
  tags,
  suggestions,
  onChange,
}: {
  tags: string[];
  suggestions: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  function add(raw: string) {
    const t = raw.trim();
    setDraft("");
    if (!t || tags.includes(t)) return;
    onChange([...tags, t]);
  }
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
        tags
      </label>
      {tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {tags.map((t) => {
            const isFlow = t.startsWith("flow:");
            return (
              <span
                key={t}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  isFlow ? "bg-indigo-100 text-indigo-700" : "bg-zinc-100 text-zinc-600"
                }`}
              >
                {isFlow ? t.slice("flow:".length) : t}
                <button
                  type="button"
                  onClick={() => onChange(tags.filter((x) => x !== t))}
                  title="remove tag"
                  className="leading-none text-zinc-400 hover:text-red-600"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
      <input
        type="text"
        list="case-tag-suggestions"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => add(draft)}
        placeholder="add tag — e.g. happy, negotiation, flow:…"
        className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
      />
      {/* Options only once the user types — an empty datalist won't pop the
          whole list open on focus (native <datalist> behavior in Chrome). */}
      <datalist id="case-tag-suggestions">
        {draft.trim() !== "" &&
          suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}

interface CaseEditorProps {
  testCase: TestCase;
  onBack: () => void;
  onNew: () => void;
}

// Which actor drives a case. user_turns → scripted; persona_id → referenced
// persona; system_prompt → inline one-off. A new/empty case defaults to
// scripted (the most common shape).
function actorOf(tc: TestCase): Actor {
  if (Array.isArray(tc.user_turns)) return "scripted";
  if (typeof tc.persona_id === "string") return "persona";
  if (typeof tc.system_prompt === "string") return "inline";
  return "scripted";
}

function CaseEditor({ testCase, onBack, onNew }: CaseEditorProps) {
  const saveCase = useTestsStore((s) => s.saveCase);
  const deleteCase = useTestsStore((s) => s.deleteCase);
  const uniqueCaseId = useTestsStore((s) => s.uniqueCaseId);
  const personas = useTestsStore((s) => s.personas);
  const rubrics = useTestsStore((s) => s.rubrics);
  const casesCount = useTestsStore((s) => s.cases.length);
  const spec = useSpecStore((s) => s.spec);
  const simulateMode = useSimulateStore((s) => s.mode);
  const reset = useSimulateStore((s) => s.reset);
  const setPersonaPrompt = useSimulateStore((s) => s.setPersonaPrompt);
  const setPersonaTraits = useSimulateStore((s) => s.setPersonaTraits);
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
  // Actor = how the conversation is driven. Exactly one (the binding
  // invariant): scripted (user_turns), persona (referenced reusable actor),
  // or inline (one-off system_prompt). Fixture (vars + mocks) is independent
  // and situational — it merges over the bound persona's intrinsic fixture.
  const [actor, setActor] = useState<Actor>(actorOf(testCase));
  const [userTurns, setUserTurns] = useState<UserTurn[]>(testCase.user_turns ?? []);
  const [personaId, setPersonaId] = useState(testCase.persona_id ?? "");
  const [inlinePrompt, setInlinePrompt] = useState(testCase.system_prompt ?? "");
  const [vars, setVars] = useState<Record<string, unknown>>(testCase.vars ?? {});
  const [mocks, setMocks] = useState<Record<string, MockBehavior>>(testCase.mocks ?? {});
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
  const [tags, setTags] = useState<string[]>(testCase.tags ?? []);
  const [language, setLanguage] = useState(testCase.language ?? "");
  const allCases = useTestsStore((s) => s.cases);
  const setSimulateContextVars = useSimulateStore((s) => s.setContextVars);
  const setMockError = useSimulateStore((s) => s.setMockError);
  const availableLanguages = spec?.agent.meta.languages ?? [];
  const showLanguage = availableLanguages.length > 1;

  // Re-hydrate draft when the selected case identity changes.
  useEffect(() => {
    setName(testCase.name ?? "");
    setActor(actorOf(testCase));
    setUserTurns(testCase.user_turns ?? []);
    setPersonaId(testCase.persona_id ?? "");
    setInlinePrompt(testCase.system_prompt ?? "");
    setVars(testCase.vars ?? {});
    setMocks(testCase.mocks ?? {});
    setPerTurnRows(flattenPerTurn(testCase.assertions ?? []));
    setTranscriptAssertions(testCase.transcript_assertions ?? []);
    setStateAssertions(testCase.state_assertions ?? []);
    setCapabilityAssertions(testCase.capability_assertions ?? []);
    setEvaluators(testCase.evaluators ?? []);
    setNotes(testCase.notes ?? "");
    setTags(testCase.tags ?? []);
    setLanguage(testCase.language ?? "");
  }, [testCase.id]);

  const spec_capabilities = useMemo(() => spec?.agent.capabilities ?? [], [spec]);
  const declaredVars = useMemo(() => collectDeclaredVariables(spec), [spec]);
  const mockableCaps = useMemo(() => collectMockableCapabilities(spec), [spec]);
  // Datalist vocabulary: every tag already in the library (so the folksonomy
  // converges instead of sprawling) plus a flow:<id> suggestion per spec flow.
  const tagSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCases) for (const t of c.tags ?? []) set.add(t);
    for (const f of spec?.flows ?? []) set.add(`flow:${f.id}`);
    return [...set].sort();
  }, [allCases, spec]);
  const boundPersona = useMemo(
    () => (actor === "persona" ? personas.find((p) => p.id === personaId) : undefined),
    [actor, personaId, personas],
  );
  // Dirty = any editable field diverged from the saved record. Matches
  // the persona-row pattern so the Save button greys out after a save
  // (testCase prop updates → draft already matches → dirty becomes false).
  // JSON.stringify is good enough for the small case shape; saves writing
  // a deep-equal helper.
  const dirty =
    name !== (testCase.name ?? "") ||
    actor !== actorOf(testCase) ||
    JSON.stringify(userTurns) !== JSON.stringify(testCase.user_turns ?? []) ||
    personaId !== (testCase.persona_id ?? "") ||
    inlinePrompt !== (testCase.system_prompt ?? "") ||
    JSON.stringify(vars) !== JSON.stringify(testCase.vars ?? {}) ||
    JSON.stringify(mocks) !== JSON.stringify(testCase.mocks ?? {}) ||
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
    JSON.stringify(tags) !== JSON.stringify(testCase.tags ?? []) ||
    language !== (testCase.language ?? "");

  function handleSave() {
    const next: TestCase = {
      $schema: "flowstore://test/case/v0",
      id: testCase.id,
      ...(name.trim() ? { name: name.trim() } : {}),
      // Exactly one actor (the binding invariant). max_turns caps a
      // simulated-user run; it's controlled from the Simulate panel
      // (personaTurnLimit) at run time, so preserve any pre-existing value
      // for persona/inline actors but don't surface it in the editor.
      ...(actor === "scripted" ? { user_turns: userTurns } : {}),
      ...(actor === "persona" && personaId ? { persona_id: personaId } : {}),
      ...(actor === "inline" ? { system_prompt: inlinePrompt } : {}),
      ...(actor !== "scripted" && testCase.max_turns !== undefined
        ? { max_turns: testCase.max_turns }
        : {}),
      // Situational fixture (merges over the bound persona's intrinsic fixture).
      ...(Object.keys(vars).length > 0 ? { vars } : {}),
      ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(showLanguage && language ? { language } : {}),
      ...(perTurnRows.length > 0 ? { assertions: groupPerTurn(perTurnRows) } : {}),
      ...(transcriptAssertions.length > 0
        ? { transcript_assertions: transcriptAssertions }
        : {}),
      ...(stateAssertions.length > 0 ? { state_assertions: stateAssertions } : {}),
      ...(capabilityAssertions.length > 0
        ? { capability_assertions: capabilityAssertions }
        : {}),
      ...(evaluators.length > 0 ? { evaluators } : {}),
      // Preserve fields the editor doesn't surface (model); language is
      // preserved when not editable (monolingual project).
      ...(testCase.model !== undefined ? { model: testCase.model } : {}),
      ...(!showLanguage && testCase.language !== undefined
        ? { language: testCase.language }
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

  function handleCopy() {
    const base = testCase.name ? `${testCase.name} copy` : `${testCase.id}-copy`;
    const newId = uniqueCaseId(base);
    saveCase({
      ...testCase,
      id: newId,
      ...(testCase.name ? { name: `${testCase.name} copy` } : {}),
    });
    onBack();
  }

  async function handleOpenInSimulate() {
    await reset();
    // Hydrate the simulate buffer with the resolved fixture (persona ∪ case),
    // and the simulated-user prompt from whichever actor drives the case:
    // the bound persona's system_prompt (persona actor) or the case's inline
    // system_prompt. A scripted case has no simulated-user prompt to load.
    if (actor === "persona") {
      setPersonaPrompt(boundPersona?.system_prompt ?? "");
      setPersonaTraits(boundPersona?.traits);
    } else if (actor === "inline") {
      setPersonaPrompt(inlinePrompt);
      setPersonaTraits(undefined);
    }
    if (spec) {
      const { vars: rVars, returns, errors } = caseWorldToRuntime(
        spec,
        boundPersona,
        { vars, mocks },
      );
      setSimulateContextVars(rVars);
      setMockReturns(returns);
      for (const [name, err] of Object.entries(errors)) {
        setMockError(name, err);
      }
    }

    // Override Simulate's language picker with the case's language
    // (when set). Cases are intrinsically scoped to a language for
    // multilingual specs; opening one should match.
    if (language) setSimulateLanguage(language);

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
        <button
          type="button"
          onClick={onNew}
          title="Create a new test case (rename + fill it in the editor). You can also capture from the Simulate tab."
          className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
        >
          + New
        </button>
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
            {testCase.id} | {actorOf(testCase)}
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

        <TagsField tags={tags} suggestions={tagSuggestions} onChange={setTags} />

        <div className="flex gap-2">
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
            actor
          </label>
          <div className="mt-1 flex gap-3">
            <label className="flex items-center gap-1.5" title="Feed scripted user turns verbatim.">
              <input type="radio" checked={actor === "scripted"} onChange={() => setActor("scripted")} />
              <span className="text-[11px]">scripted</span>
            </label>
            <label className="flex items-center gap-1.5" title="Drive an LLM-as-user from a reusable persona's system prompt.">
              <input type="radio" checked={actor === "persona"} onChange={() => setActor("persona")} />
              <span className="text-[11px]">persona</span>
            </label>
            <label className="flex items-center gap-1.5" title="Drive an LLM-as-user from an inline one-off system prompt.">
              <input type="radio" checked={actor === "inline"} onChange={() => setActor("inline")} />
              <span className="text-[11px]">inline prompt</span>
            </label>
          </div>

          {actor === "scripted" && (
            <UserTurnsList turns={userTurns} onChange={setUserTurns} />
          )}

          {actor === "persona" &&
            (personas.length === 0 ? (
              <div className="mt-2 text-[11px] text-zinc-500 italic">
                No saved personas. Create one in the Personas tab, or use an inline prompt.
              </div>
            ) : (
              <select
                value={personaId}
                onChange={(e) => setPersonaId(e.target.value)}
                title="Reusable actor. Its system_prompt drives the simulated user; its vars + mocks are inherited, with this case's fixture overriding per key."
                className="mt-2 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800"
              >
                <option value="">— pick a persona —</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))}
              </select>
            ))}

          {actor === "inline" && (
            <textarea
              value={inlinePrompt}
              onChange={(e) => setInlinePrompt(e.target.value)}
              rows={6}
              placeholder="One-off system prompt for the simulated user (no reusable persona file)."
              className="mt-2 w-full resize-y rounded border border-zinc-300 bg-white p-2 font-mono text-[11px] leading-snug text-zinc-800"
            />
          )}
        </div>

        <Section label="fixture">
          <VarsEditor
            declared={declaredVars}
            values={vars}
            onChange={(n, value) => {
              const next = { ...vars };
              if (value === undefined || value === null || value === "") delete next[n];
              else next[n] = value;
              setVars(next);
            }}
          />
          <MocksEditor
            caps={mockableCaps}
            behaviors={mocks}
            keyOf={(cap) => cap.capabilityId}
            onChange={(k, behavior) => {
              const next = { ...mocks };
              if (behavior === undefined) delete next[k];
              else next[k] = behavior;
              setMocks(next);
            }}
          />
          {actor === "persona" && boundPersona && (
            <PersonaFixtureView
              vars={boundPersona.vars ?? {}}
              mocks={boundPersona.mocks ?? {}}
              capabilities={spec_capabilities}
            />
          )}
        </Section>

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

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-200">
          <button
            type="button"
            onClick={handleDelete}
            title="Delete this case."
            className="rounded border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleOpenInSimulate}
              title="Load this case's persona/mocks into the Simulate tab and switch to it."
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
            >
              Open in Sim ▶
            </button>
            <button
              type="button"
              onClick={handleCopy}
              title="Duplicate this case — handy for variant authoring (same persona, different assertions)."
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty}
              title={dirty ? "Save changes to this case." : "No unsaved edits."}
              className="rounded-md bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// Read-only view of the bound persona's INTRINSIC fixture — the vars/mocks the
// case inherits. Sits beside the editable case fixture above it; the two
// sections together are the persona ∪ case merge, shown by separation rather
// than threading provenance into the shared editors. mocks are keyed by
// capability id; map to name for display.
function PersonaFixtureView({
  vars,
  mocks,
  capabilities,
}: {
  vars: Record<string, unknown>;
  mocks: Record<string, MockBehavior>;
  capabilities: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const nameOf = (id: string) => capabilities.find((c) => c.id === id)?.name ?? id;
  const varEntries = Object.entries(vars);
  const mockEntries = Object.entries(mocks);
  if (varEntries.length === 0 && mockEntries.length === 0) return null;
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-zinc-100"
        title="Inherited from the bound persona; read-only here. Edit it on the persona. The case fixture above merges over these."
      >
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          from persona · {varEntries.length} vars · {mockEntries.length} mocks
        </span>
        <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-zinc-100 px-2 py-2 font-mono text-[10px] text-zinc-700">
          {varEntries.map(([k, v]) => (
            <div key={k} className="truncate">
              <span className="text-zinc-500">{k}</span> = {JSON.stringify(v)}
            </div>
          ))}
          {mockEntries.map(([id, b]) => (
            <div key={id} className="truncate">
              <span className="text-zinc-500">{nameOf(id)}</span>{" "}
              {b.kind === "error" ? `→ error: ${b.error}` : `→ ${JSON.stringify(b.returns)}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// A scripted turn is either plain text or a voice barge-in object
// ({text, barge_in}); the editor edits the text and preserves the barge-in
// flag (authored in JSON / the voice harness, not toggled here).
function turnText(t: UserTurn): string {
  return typeof t === "string" ? t : t.text;
}
function setTurnText(t: UserTurn, text: string): UserTurn {
  return typeof t === "string" ? text : { ...t, text };
}

function UserTurnsList({
  turns,
  onChange,
}: {
  turns: UserTurn[];
  onChange: (turns: UserTurn[]) => void;
}) {
  function update(i: number, text: string) {
    onChange(turns.map((t, idx) => (idx === i ? setTurnText(t, text) : t)));
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
          <div className="flex-1">
            <textarea
              value={turnText(t)}
              onChange={(e) => update(i, e.target.value)}
              rows={1}
              className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800 resize-y"
            />
            {typeof t !== "string" && t.barge_in && (
              <span className="text-[10px] text-amber-700">⊣ barge-in</span>
            )}
          </div>
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
        + add
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
        + add
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
        "Return a JSON object with `score` (integer {scale.min}-{scale.max}) " +
        "and `notes` (one-sentence explanation citing the specific turn(s) that " +
        "drove the score; turn 1 is the agent's first message).",
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
          const builtinDesc = rubric
            ? null
            : BUILTIN_EVALUATORS[v] ?? "Python evaluator (hand-authored)";
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
                      : `Built-in evaluator — runs automatically; edit tests/evaluators/${v}.py to change.`
                  }
                >
                  <div className="flex items-center gap-1">
                    {rubric && (
                      <span className="text-zinc-400 text-[10px]">
                        {isExpanded ? "▾" : "▸"}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[11px] text-zinc-800">{primary}</span>
                        {!rubric && (
                          <span className="shrink-0 rounded bg-zinc-100 px-1 text-[9px] uppercase tracking-wide text-zinc-500">
                            built-in
                          </span>
                        )}
                      </div>
                      {rubric?.name && rubric.name !== v && (
                        <div className="truncate font-mono text-[10px] text-zinc-500">
                          {v}
                        </div>
                      )}
                      {builtinDesc && (
                        <div className="truncate text-[10px] text-zinc-500">{builtinDesc}</div>
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
  // (saveRubric marks the project dirty). Save commits the draft. scale is the
  // numeric range the judge returns; consumers (the editor's display, the
  // runner's threshold/mean math) read it, so surface it for editing here. Use
  // {scale.min}/{scale.max} in the prompt_template to keep the prose range in
  // sync with this field.
  const [name, setName] = useState(rubric.name ?? "");
  const [criteria, setCriteria] = useState(rubric.criteria);
  const [promptTemplate, setPromptTemplate] = useState(rubric.prompt_template);
  const [scaleMin, setScaleMin] = useState(String(rubric.scale.min));
  const [scaleMax, setScaleMax] = useState(String(rubric.scale.max));

  useEffect(() => {
    setName(rubric.name ?? "");
    setCriteria(rubric.criteria);
    setPromptTemplate(rubric.prompt_template);
    setScaleMin(String(rubric.scale.min));
    setScaleMax(String(rubric.scale.max));
  }, [rubric.id]);

  const parsedMin = Number(scaleMin);
  const parsedMax = Number(scaleMax);
  const scaleValid =
    scaleMin.trim() !== "" &&
    scaleMax.trim() !== "" &&
    Number.isFinite(parsedMin) &&
    Number.isFinite(parsedMax) &&
    parsedMin < parsedMax;

  const dirty =
    name !== (rubric.name ?? "") ||
    criteria !== rubric.criteria ||
    promptTemplate !== rubric.prompt_template ||
    parsedMin !== rubric.scale.min ||
    parsedMax !== rubric.scale.max;

  function handleSave() {
    onSave({
      $schema: "flowstore://test/rubric/v0",
      id: rubric.id,
      ...(name.trim() ? { name: name.trim() } : {}),
      criteria,
      scale: { min: parsedMin, max: parsedMax },
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
          scale
        </label>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            value={scaleMin}
            onChange={(e) => setScaleMin(e.target.value)}
            aria-label="scale minimum"
            className="w-16 rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px]"
          />
          <span className="text-[11px] text-zinc-400">to</span>
          <input
            type="number"
            value={scaleMax}
            onChange={(e) => setScaleMax(e.target.value)}
            aria-label="scale maximum"
            className="w-16 rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px]"
          />
          {!scaleValid && (
            <span className="text-[10px] text-red-600">min must be &lt; max</span>
          )}
        </div>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
          prompt_template
        </label>
        <textarea
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          rows={5}
          placeholder="LLM-judge prompt. Placeholders: {transcript}, {criteria}, {scale.min}, {scale.max}."
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
          disabled={!dirty || !scaleValid}
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
