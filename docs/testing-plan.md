# Testing flowstore Agents

Audience: anyone authoring tests, building test infrastructure, or asking "how does testing actually work here?" This is the canonical entry point — read it first, then drill into the referenced detail docs as needed.

For *deep methodology* (anti-patterns, when-red-what-to-change, trial counts) see [test-driven-prompts.md](test-driven-prompts.md). For *bring-your-own-script mechanics* (file shapes, the compile CLI, mock dispatch) see [testing-from-scripts.md](testing-from-scripts.md). For *runner-driver mechanics* (HTTP wire protocol, A/B against the system-prompt path) see [runner-testing.md](runner-testing.md). For the *systems-level view* of how testing feeds optimization see [optimization-loop.md](optimization-loop.md).

This doc supersedes the previous Phase 2 testing-loop plan.

---

## TL;DR

Tests live as JSON under `tests/` in any flowstore project. Scripts (typically Python) drive them; results land under `tests/runs/<ts>-<label>/`. The editor's SimulatePanel runs single cases live and (eventually) renders results inline.

Three things make this work end-to-end:

1. **File schemas** (`test-case/v0`, `gold/v0`, `persona/v0`, `capability-mock/v0`, `rubric/v0`, `result/v0`) — the contract between authors, scripts, and the editor.
2. **`flowstore-compile`** — emits either `{system_prompt, tool_schemas}` (for script-driven LLM testing) or the resolved spec (for runner-driven testing). Same project source, two consumption shapes.
3. **A driver script per project** — owns the LLM loop, mock dispatch, evaluator framework, and result file emission. We ship reference implementations; projects own and adapt them.

The reference implementation is the [`awaaz-dpd31`](../../awaaz-dpd31) sibling repo: 18 test cases, 23 golds, 6 personas, 4 rubrics, a working derive-cases pipeline, a working rubric judge, and 3 runs.

---

## The framework

Conversational agents have multiple kinds of behavior worth testing. Today's `test-case/v0` shape collapses them into one mold, which works for the most common kind (full-conversation tests) and strains for the others. The framework below names the units so that future schema additions don't accidentally fork.

### Three units of testing

**Conversation tests** — *one sequence of turns, one outcome.*

The native fit of today's `test-case/v0`. Scripted user turns (or LLM-as-user driven by a persona) feed through the agent; assertions check per-turn substrings, end-state variables, or whole-transcript rubric scores. This is the integration-test layer: it tests *composition* of routing decisions into outcomes. All 18 cases in awaaz-dpd31 are this shape.

Status: **built.** Schema additions on deck (tags, state assertions, transcript assertions — see the plan).

**Decision tests** — *one moment, many inputs, one assertion class.*

Pins a specific point in the conversation (a prefix of N turns ending with a specific agent utterance), then runs many candidate user inputs through that point and asserts each is classified/routed correctly. Maps 1:1 to `flow.exit_paths[].condition`: each condition is a classifier that's expensive to verify only in full-conversation tests.

The cost-per-assertion is dramatically lower than conversation tests (no full transcript per input; the prefix runs once and forks). The shape is denser per file.

Status: **not built.** Planned as T-D.

**Property tests** — *one invariant, many conversations.*

Asserts a global property over a transcript or a suite. Two sub-flavors:

- **Cheap predicates**: regex, substring, ordering, length, state correlation over the *whole* transcript. Deterministic, fast, can run on every change. The right tool for "agent never says X" — `must_not_contain` per-turn misses leaks that happen on a turn the assertion isn't watching. Status: **not built.** Planned as T-P.
- **Semantic rubrics**: LLM-as-judge over a transcript, optionally compared to a gold. The right tool for "agent acknowledged the customer's hardship before offering an alternative" — anything that depends on paraphrase, tone, intent, or outcome equivalence. Status: **built.** Lives in `rubric/v0` schema + the per-project `_judge.py` (reference impl in awaaz-dpd31). Existing rubric `outcome_matches_gold` wires the `{gold_standard}` template slot for gold-comparison grading.

The two property flavors are complementary, not redundant. Cheap predicates are the canary (every PR); rubrics are the depth check (nightly). Only-T-P means paraphrased guardrail violations slip through; only-rubrics means LLM cost on every commit for things a regex would catch in 1ms.

### Why split the units

The unit determines what gets persisted, judged, aggregated, and surfaced. A decision-test result viewer is a matrix per turn position (input × verdict); a conversation-test result viewer is a transcript with a verdict at the bottom; a property-test result viewer is a list of invariants with per-conversation pass rates. Collapsing them into one schema means the editor surface ends up with a switch statement on case shape and three rendering modes inside one component.

Splitting now (while only conversation tests are real) lets each surface evolve independently and compose at the run-aggregation layer.

### Orthogonal concerns

Cut across all three units:

- **Trial multiplicity (pass@N).** LLM nondeterminism. Per-trial slot exists in `result/v0`; suite-level aggregation lives in stdout today.
- **Aggregation / run manifest.** A `manifest.json` per run dir summarizing pass/fail counts and providing inter-run diff. **Deferred** — the rollup rule for heterogeneous assertion types (substrings + state + rubric scores + decision verdicts) isn't obvious yet; design once the test shape has settled with two weeks of real runs against it.
- **Coverage.** What fraction of the spec's exit_paths / FAQs / capabilities is exercised by the suite. **Deferred** until a consumer exists (most likely an optimizer reading "where to invest").
- **Provenance.** Where did each test case come from (authored, derived from gold, captured from simulate, derived from prod session, derived from bug)? Carried by `tags[]` convention (e.g. `tags: ["src:gold:basic_happy_path"]`) — no structured field unless a consumer earns it.

---

## The methodology

Distilled here; the long version with anti-patterns and when-red-what-to-change lives in [test-driven-prompts.md](test-driven-prompts.md).

### The loop

```
gold transcript ─┐
                 ├─▶ test case (assertions) ─▶ run.py (N trials) ─▶ pass@N matrix ─▶ ship / diagnose
spec / generator ┘
```

Five phases. The first time you do them for a new agent: 1 → 5 in order. After that, you re-enter at 3, 4, or 5 most of the time.

1. **Gold transcripts.** Verbatim example conversations from customer-provided docs (best), production recordings (next best), or hand-authored (bootstrap). Stored as `tests/gold/<id>.gold.json`. Extract from messy customer sources via [prompts/GOLD-EXTRACTION-PROMPT.txt](../prompts/GOLD-EXTRACTION-PROMPT.txt).
2. **Derive test cases.** A gold is the source of truth; a test case is the executable extraction (user turns + per-turn assertions). Stored as `tests/cases/<id>.test.json`. Derive mechanically via [prompts/CASE-FROM-GOLD-PROMPT.txt](../prompts/CASE-FROM-GOLD-PROMPT.txt); awaaz-dpd31 wraps this in [`scripts/derive_cases.py`](../../awaaz-dpd31/scripts/derive_cases.py).
3. **Compile.** `flowstore-compile --format prompt` for the system-prompt path; `--format spec` for the runner path. Variable substitution via `--vars-file`.
4. **Run with N trials.** `python scripts/run.py <case>.test.json --trials 3`. Result files land under `tests/runs/<ts>-<label>/`.
5. **Read the matrix, decide.** PASS (N/N) → ship. PART → flaky, diagnose. FAIL → mechanism bug. Cheapest-first investigation order: assertion → vars → spec content → spec variables → prompt generator → model.

### Key disciplines

- **pass@N, not pass@1.** Single-trial CI is just one roll of a die. Default to N=3; bump to 5–10 when investigating known flakiness.
- **Anchor on script-distinctive phrases**, not generic words. "Gracias" appears everywhere; "agencia de crédito" pins which flow fired.
- **Pair positive with negative when guardrails apply.** `must_contain: ["hola"]` + `must_not_contain: ["1100"]` catches the leak case `must_contain` alone misses.
- **1–3 assertions per case.** More and every change becomes a noisy red-cell parade.
- **Don't treat PART as PASS.** 2/3 on a routing assertion means one in three users hits the wrong branch.

---

## The mechanics

Two drivers, same input files, same result schema. Detailed wire protocol in [runner-testing.md](runner-testing.md); detailed file shapes in [testing-from-scripts.md](testing-from-scripts.md).

### Two driver paths

```
SYSTEM-PROMPT PATH                       RUNNER PATH
──────────────────                       ───────────
flowstore-compile --format prompt        flowstore-compile --format spec
       ↓                                        ↓
{system_prompt, tool_schemas}            full {agent, flows} JSON
       ↓                                        ↓
direct LLM call (your provider)          POST /api/chat/session
       ↓                                        ↓
loop user_turns                          loop user_turns
  → look up mock by capability id          → runner dispatches mock for you
  → translate tool name → id               → events expose flow + variable state
       ↓                                        ↓
flowstore://result/v0                    flowstore://result/v0
```

**Use the system-prompt path** for portability (works against any provider's tool-use API) and for grading prompt quality in isolation. **Use the runner path** when you need the real graph executor (variable bindings, structural exits, event stream) and authoritative `final_variables` in results.

Run both against the same cases to detect divergence — the runner's structural exits enforce routing the prompt path's prose loses. The `prompt_source` field in `result/v0` pivots comparisons.

### File shapes (one-line each)

- `flowstore://test-case/v0` — scripted user turns OR persona-driven, plus mock bindings + assertions + evaluator references.
- `flowstore://gold/v0` — verbatim reference transcript for a scenario.
- `flowstore://persona/v0` — user-side system prompt for LLM-as-user exploration.
- `flowstore://capability-mock/v0` — `(capability_id, variant)` → what to return when the agent tool-calls.
- `flowstore://rubric/v0` — LLM-judge criterion with prompt template; `{transcript}`, `{criteria}`, `{gold_standard}` substitution.
- `flowstore://result/v0` — per-case run output: transcript, capability_calls, final_variables, evaluator_results.

The `id` in each file must match the basename. `additionalProperties: false` on top-level objects to keep the schema as contract.

### The cross-driver gotcha

`capability.id` (editor-side stable handle) vs `capability.name` (snake_case runtime dispatch identifier). Mocks key on id; the LLM's tool calls return name; `tool_schemas[].name` in compiled prompt is name. Driver scripts maintain a `name → id` map.

---

## State of the world

What exists today.

### In `@flowstore/core`

**Schemas** — [`packages/core/src/schema/files/`](../packages/core/src/schema/files/):
- `testCase.ts` — `test-case/v0` with `id`, `user_turns` | `persona_id`, `mock_bindings`, `evaluators`, `assertions`, `gold_id`, `model`, `language`, `vars_file`. (Open: `tags`, `state_assertions`, `transcript_assertions`.)
- `gold.ts`, `persona.ts`, `capabilityMock.ts`, `rubric.ts`, `result.ts` — production shapes; stable.

**Tooling**:
- `flowstore-compile` CLI with `--format prompt` and `--format spec`, `--vars-file`, `--language`, `--agent`, `--out`.
- [`prompts/AGENT-SPEC-PROMPT.txt`](../prompts/AGENT-SPEC-PROMPT.txt) — LLM prompt for ingesting customer artifacts (docx / xlsx / PDF / text) into a flowstore spec.
- [`prompts/CASE-FROM-GOLD-PROMPT.txt`](../prompts/CASE-FROM-GOLD-PROMPT.txt) — LLM prompt for deriving cases from golds + compiled spec.
- [`prompts/GOLD-EXTRACTION-PROMPT.txt`](../prompts/GOLD-EXTRACTION-PROMPT.txt) — LLM prompt for extracting golds from customer source material.

### In the reference implementation (`awaaz-dpd31`)

Sibling repo at `~/dev/whatsupp/awaaz-dpd31/`. Built and running as of 2026-05-26.

- **18 test cases** (`tests/cases/`) covering happy / negotiation / after-grace / broken-PTP / wrong-number / relative-answered / stop-calling, plus 6 persona-driven stress cases (BAU compliant, broken-PTP defensive, hostile-evasive, red-team confused-stalling, red-team fake-authority, red-team social-engineer).
- **23 golds** (`tests/gold/`) extracted from customer Gold-standard docx.
- **6 personas**, **4 rubrics** (`no_pii_before_identity`, `outcome_matches_gold`, `routing_held`, `tone_maintained`).
- **`scripts/run.py`** — system-prompt driver, mock dispatch, substring assertions, multi-trial.
- **`scripts/run_persona.py`** — persona-driven LLM-as-user driver.
- **`scripts/derive_cases.py`** — wraps `CASE-FROM-GOLD-PROMPT.txt` to derive cases from golds.
- **`scripts/_judge.py`** — rubric judge runner; resolves `gold_id` → gold transcript → `{gold_standard}` substitution.
- **`scripts/suite_3.sh`** — multi-trial suite invocation.
- **3 runs** under `tests/runs/` (`20260526T041234Z-smoke`, `20260526T041825Z-smoke2`, `20260526T043408Z-runner`).

The `derive_cases.py` + `_judge.py` + `outcome_matches_gold` rubric collectively represent the gold-derived-cases + gold-comparison-grading pipeline working end-to-end against a real customer scenario.

**Status of the "promote to flowstore-core" question**: deliberately not yet. Need at least one more customer (N≥2) before deciding what's per-project vs core.

### In the editor (`packages/browser/`)

- **SimulatePanel** — live simulate with variable / mock / persona forms. Not yet test-case-aware.
- **Spec editing** — flows, agent, capabilities, knowledge, scripts. Stable.
- **Result viewing** — not built.

---

## The plan

**Sequencing principle.** Get the *shape and process* right before building editor UI. Schema additions (T-D, T-P, state assertions, tags) change what the editor would render; building the editor UI now means redoing it as the shape settles. Designers hand-edit test-case JSON via Claude Code / the GitHub web UI in the meantime — painful but functional, and the right tradeoff while the schema is in flight.

The trigger to start editor work: the schema additions have been in real use for ~2 weeks against awaaz-dpd31 (and ideally one more customer) without surfacing new needs.

### Phase A — schema + Python (land first)

| # | Item | Where | Size | Schema delta | Unlocks |
|---|------|-------|------|--------------|---------|
| 1 | **N-2** `tags[]` on test-case | core + Python | 1 hr | `tags: string[]` on `test-case/v0`; `--tag` filter in `run.py` | Routing-bucket filtering; carrier for provenance conventions; carrier for decision-test prefix sharing |
| 2 | **T-P** `transcript_assertions[]` | core + Python | ½ day | New `transcript_assertions[]` slot on `test-case/v0`: regex / substring / count / must_terminate_within over the whole transcript | Cheap structured guardrail checks complementary to rubrics |
| 3 | **O-1** `state_assertions[]` | core + Python | ½ day | New `state_assertions[]` slot on `test-case/v0`: `{variable, equals?, matches?, is_set?}` over `result.final_variables` | End-state checks for capability-bound flows (the load-bearing mechanic Tala / FNOL need) |
| 4 | **Per-case diff CLI** | Python | ½ day | — | "What changed between yesterday's run and today's?" without a manifest — a script over paired result files |
| 5 | **T-D** Decision test shape | core + Python | 1 day (after design call) | NEW: either `flowstore://decision-test/v0` file type or `kind: "decision"` discriminator on `test-case/v0` (open question — see decisions below) | Cheap per-routing-decision testing; matches `flow.exit_paths[].condition` 1:1; dramatically lowers per-input cost |

Phase A is roughly ~2.5 days of work plus the T-D design call. Lands the testing shape against awaaz-dpd31 with no editor dependencies.

**Prompt-content debugging — sidecar pattern, not a result-schema field.** "What did the model actually see at the turn that misbehaved?" is a real diagnostic need (especially on the runner path where prompts swap per flow transition). Resolved out-of-band: the runner emits an `LLMCalled` event into its existing event stream (alongside `flow_entered`, `capability_invoked`, etc.). For test runs, point `FLOWSTORE_EVENT_LOG_DIR` at the run dir and the events land as a sidecar `*.jsonl` artifact correlated by `session_id`. The result viewer (Phase B O-3) reads both result + sidecar events. No `result/v0` schema change needed — keeps runtime artifacts lean and aligns with the "authored vs runtime artifacts have different contract postures" principle. Runner implementation lives in the flowstore-runner repo (event schema + `_run_inference` hook + a second env var `FLOWSTORE_LOG_LLM_CALLS` to gate prompt-payload cost independently); for script-driver mode, the static system prompt is recoverable by re-running `flowstore-compile` with the case's `vars_file` — no instrumentation needed.

### Phase B — editor surface (after Phase A settles)

Wait for Phase A to soak. Then build all four together as one coherent feature (they share the SimulatePanel surface and zustand store):

| # | Item | Size | What it does |
|---|------|------|--------------|
| 7 | **I-1** Test-case panel — list / view / edit / save / delete | 2 days | Full CRUD against `tests/cases/*.test.json`; lives in the editor sidebar alongside the existing inspectors |
| 8 | **I-2** Capture-as-test-case button | ½ day | Finished-transcript → new `test-case/v0` in I-1's list, with empty assertions for the designer to fill |
| 9 | **I-3** "Run this case" + progress | 1 day | One-click run from the panel; surfaces progress; navigates to the result view on completion |
| 10 | **O-3** Result viewer | 1 day | Read-only render of one `result/v0` file in the transcript surface; per-assertion pass/fail, `final_variables`, `capability_calls`, model/prompt metadata. When a sidecar `*.jsonl` event log is present in the run dir (runner-driven tests with `FLOWSTORE_LOG_LLM_CALLS=true`), correlate `LLMCalled` events with turns — click a turn to see the system prompt the model saw |

Phase B totals ~4.5 days. Bundled, not piecemeal — splitting risks half-built editor states where the panel exists but can't run, or capture lands cases the panel can't render.

### What designers do meanwhile (Phase A only, no editor UI)

- **Author / edit test cases via Claude Code or the GitHub web UI.** The schemas are simple enough that JSON-editing is workable for the pilot. Claude Code knows the schemas (`test-case/v0`, etc.) and validates as it edits.
- **Capture from simulate by copying the transcript.** Read the transcript out of SimulatePanel; paste into a new `tests/cases/<id>.test.json`; ask Claude Code to extract user turns and seed assertions.
- **Review results via the run dir.** `tests/runs/<ts>-<label>/<case>.result.json` is human-readable; the per-case diff CLI (item 4) handles "what changed between two runs."

This isn't great. It's deliberately *just barely good enough* so we don't build editor UI on a moving target.

### Deferred (with reason)

- **O-2 run manifest + diff aggregation.** The diff half is the per-case diff CLI (item 4 above). The manifest half is deferred until the test shape has settled with two weeks of real runs: the rollup rule for heterogeneous assertion types (substrings + state + transcript predicates + rubric scores + decision verdicts) isn't obvious yet and is policy, not schema.
- **T-C coverage manifest.** No consumer yet. Build when an optimizer reads "where to invest."
- **Provenance as a structured field.** `tags[]` (N-2) carries it by convention (`tags: ["src:gold:<id>"]`, `tags: ["src:session:<id>"]`). Promote to a structured field if a fast filter consumer emerges.
- **Persona / rubric / gold editing UI.** Designers hand-edit JSON via Claude Code. Build editor surfaces when the pilot surfaces specific friction; the schemas are small enough that JSON-editing isn't the dealbreaker.
- **Suite-level run from the editor.** Today the suite runs from `scripts/suite_3.sh` in the project repo. Bringing this into the editor needs the run manifest (deferred) to render aggregate results coherently.
- **Inter-run diff in the editor.** The per-case diff CLI (Phase A item 4) covers the cheap version; an editor-side diff viewer is downstream of both the manifest and O-3.
- **Voice-mode silence semantics.** `User: ""` scenarios in customer goldens (silence / VAD timeout) are voice-mode concerns. Out of scope for the text-mode harness; covered by the runner's voice surface when that path matures.
- **Endpoint mode.** Running the harness against a deployed agent endpoint (alongside or instead of the prompt-driven model). On Phase 2 plan; not blocked, just not prioritized.

### Decisions still open

- **T-D file type vs discriminator.** New `flowstore://decision-test/v0` (cleanly separate; new producer/consumer contract) vs adding `kind: "decision"` to `test-case/v0` (one schema; loader / runner / viewer branch internally). New file type is the more honest cut but costs more downstream surface; discriminator is cheaper but couples surfaces.
- **Promote per-project test infra to core.** `derive_cases.py`, `_judge.py`, `outcome_matches_gold.rubric.json` work in awaaz-dpd31. Move to core after N≥2 customers stress-test the shape. Default: not yet.

---

## URI namespace split

Concurrent with Phase A: split the flat `flowstore://<type>/v0` URI space into four buckets. Cheap to do now (N=1 production customer + 3 example projects + 1 runner repo, all under our control); strictly more expensive every customer that ships before the split.

| Bucket | Members | Posture |
|---|---|---|
| `flowstore://spec/` | `agent`, `flow`, `knowledge-table`, `project-glossary`, `models`, `project` (flowstore.json) | The runtime contract. An implementer of a flowstore-compatible runtime must support all of these. Strict additivity. |
| `flowstore://test/` | `case` (was `test-case`), `gold`, `persona`, `rubric`, `mock` (was `capability-mock`), `decision-test` (T-D, future) | Authored test artifacts. Optional for a runtime; required for the testing surface. Strict additivity. |
| `flowstore://run/` | `result`, `run-manifest` (future) | Runtime observation artifacts. Strict on the core observation shape; **permissive at the top level for debug/instrumentation extensions**. Prompt-content debugging is handled out-of-band via the runner's event stream (see runner-emitted `LLMCalled` events as a sidecar), not via a result-schema field. |
| `flowstore://meta/` | `comment`, future coverage / suite-config | Project annotation. Not spec, not test, not run. |

**Renames worth doing in the same pass:**
- `test-case` → `case` under `test/` (the bucket already says "test"; `flowstore://test/case/v0` reads cleaner than `flowstore://test/test-case/v0`)
- `capability-mock` → `mock` under `test/` (same logic; also file location is currently `capabilities/<id>.<variant>.mock.json` — geographically inconsistent with the new `test/` namespace, so a follow-up should move files under `tests/mocks/`)

### Migration scope

Repos that need `$schema` updates:

| Location | Shapes present | Notes |
|---|---|---|
| `@flowstore/core/src/schema/files/` | all | source of truth — rename files + URI literals |
| `flowstore/examples/coffee/`, `flowstore/examples/fnol/` | spec only (agent + flow + knowledge-table + project-glossary + project) | grep-and-sed |
| `flowstore/examples/coffee-testing/` | spec + test (case, persona, rubric, mock) | the only example that exercises the test/ bucket |
| `flowstore-runner/` | spec only (agent + flow) | scan its examples too |
| `~/Desktop/flowstore/awaaz/` | spec only (agent + flow) — confirmed | the single-file Tala specs from before decomposition |
| `awaaz-dpd31/` | spec + test + run (case, gold, persona, rubric, mock, result) | the largest migration; includes existing run dirs under `tests/runs/` |

Pre-split URIs are not supported. CHANGELOG / commit message should say "URI scheme split into spec/test/run/meta buckets; migrate `$schema` fields in any project repo." Per CLAUDE.md ("backward compatibility is not a default goal"), we don't maintain old-prefix readers.

---

## Schema changes — consolidated

For implementers. All additive; no migrations needed beyond the URI rename above.

### `flowstore://test/case/v0`

```ts
// existing fields unchanged; additions:

tags: Type.Optional(Type.Array(Type.String())),
// N-2: routing-bucket filtering. Conventions for provenance:
// "src:gold:<id>", "src:session:<id>", "src:bug:<id>", "src:authored".

const StateAssertion = Type.Object(
  {
    variable: Type.String(),
    equals: Type.Optional(Type.Any()),
    matches: Type.Optional(Type.String()),  // regex against stringified value
    is_set: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
state_assertions: Type.Optional(Type.Array(StateAssertion)),
// O-1: end-state checks against result.final_variables.

const TranscriptAssertion = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("substring"),
      Type.Literal("regex"),
      Type.Literal("count"),
      Type.Literal("must_terminate_within"),
    ]),
    pattern: Type.Optional(Type.String()),
    must_appear: Type.Optional(Type.Boolean()),
    max_occurrences: Type.Optional(Type.Integer()),
    min_occurrences: Type.Optional(Type.Integer()),
    max_turns: Type.Optional(Type.Integer()),
    // exactly one operand per kind; enforced in runner.
  },
  { additionalProperties: false },
);
transcript_assertions: Type.Optional(Type.Array(TranscriptAssertion)),
// T-P: cheap predicates over the whole transcript.
```

### NEW: T-D decision tests (pending design call)

Either `flowstore://test/decision-test/v0` (new file type) or `kind: "decision"` discriminator on `flowstore://test/case/v0`. Shape:

```ts
const DecisionBranch = Type.Object(
  {
    user_input: Type.String(),
    expected_class: Type.Optional(Type.String()),   // tag / route name
    must_contain: Type.Optional(Type.Array(Type.String())),
    must_not_contain: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

// Decision-test core:
prefix_turns: Type.Array(Type.String()),  // user turns to set up the state
branches: Type.Array(DecisionBranch),     // many inputs to test at this point
```

### `flowstore://run/result/v0` — top-level posture flip

**Schema change**: flip top-level `additionalProperties` from `false` to `true`. The core *observation* shape (`transcript`, `capability_calls`, `final_variables`, `evaluator_results`, `trials`) stays strict; future debug / instrumentation fields at the top level ride along as conventions, not schema-bound members. Matches the cross-cutting principle below (authored vs runtime artifacts).

No `llm_calls[]` slot — prompt-content debugging lives in the runner's event stream as `LLMCalled` events, written as a sidecar `*.jsonl` artifact when `FLOWSTORE_EVENT_LOG_DIR` is pointed at the run dir. The result viewer correlates by `session_id`.

Decision tests will also add a `branches[]` array under `evaluator_results` (or equivalent) describing per-branch verdicts when the implementation lands.

---

## Cross-cutting principles

- **Tags as the convention carrier.** Provenance, decision-test grouping, suite filtering — all ride on `tags[]` rather than forking the schema. A `tags[]` value with a colon-prefixed namespace (`src:`, `kind:`, `priority:`) is the lightweight convention; promote to a structured field only when a consumer earns it.
- **Authored vs runtime artifacts have different contract postures.** Authored content (spec/* and test/* — flows, agent, cases, golds, personas, rubrics, mocks) is reviewed in PRs, versioned with the project, and lives under strict schemas: `additionalProperties: false` at the top, additive evolution. Runtime artifacts (run/* — results, future manifests) are emitted by runs, large, and naturally accrete debug fields; they commit only to a core *observation* shape (transcript, capability_calls, final_variables, evaluator_results) with `additionalProperties: true` at the top so future instrumentation extensions ride along as conventions, and producer-specific debug data (e.g. the runner's per-call `LLMCalled` events) lives in producer-native sidecar streams instead of being shoehorned into the shared schema. Promote a convention to a schema slot only when multiple consumers need shape validation.
- **Additive-by-default schema evolution.** Within the strict portions, new fields ride along without breaking older readers; removed fields require a coordinated bump.
- **Two-driver parity.** Every test shape works against both the system-prompt path and the runner path. The runner path is authoritative for `final_variables`; the system-prompt path is authoritative for "what would this prompt do without graph enforcement."
- **LLM-agnostic deliverables.** Test-case files, rubric files, prompt extractor files name no specific provider. Reference scripts use Gemini today because that's what awaaz-dpd31 uses; the prompt extractors are LLM-agnostic by design.
- **Per-project infrastructure before core.** New test infra lives in the project that needs it (`awaaz-dpd31/scripts/`) until a second customer needs the same shape. Promotion to core requires N≥2 evidence, not speculation.
- **Underspecified beats fabricated.** Test cases that hand-author assertions the LLM "should" produce, without a gold backing them up, drift into testing what the author *imagined* the agent would say. Always derive from a gold (or a captured session) when one exists.

---

## When red, what to read

- Substring assertion fails but the agent did the right thing → revise the assertion. See [test-driven-prompts.md § When red, what to change](test-driven-prompts.md#when-red-what-to-change).
- State assertion fails → check whether the capability fired; whether its `outputs` are declared; whether the runner ran (state assertions need the runner path).
- Transcript assertion fails on a paraphrase → either tighten the pattern or migrate the check to a rubric.
- Rubric fails → read the judge's `notes` first, then the transcript. If the judge is wrong, harden the rubric's `criteria` or `prompt_template`. If the judge is right, follow the conversation-test cheapest-first ladder.
- Decision test fails on one branch only → likely an `exit_path.condition` ambiguity; check the prompt rendering of the surrounding flow.
- Runner-path passes, system-prompt-path fails → routing-as-prose lost something the runner's structural exits enforce. Either the prompt generator needs stronger routing guidance or the spec has a structural seam the prose can't capture.
