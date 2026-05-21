# UX4 MVP Plan

The organizing vision and staged operational plan for UX4. This doc is the answer to "what are we building and when." For the data-model contract see [SCHEMA.md](./SCHEMA.md); for the on-disk layout see [FILE-MODEL.md](./FILE-MODEL.md); for architectural rationale see [AGENTS.md](./AGENTS.md); for the translation/fidelity experiment that gates runner-based testing see [TRANSLATION-POC.md](./TRANSLATION-POC.md).

---

## Status (2026-05-21)

**Phase 0 — original uxflows MVP — shipped 2026-05-08.** The visual editor for v0 specs is complete: canvas authoring, schema-driven inspectors, scripts sheet with multilingual columns, simulate panel, system-prompt codegen, AJV validation, LLM-assisted authoring. Details in [Phase 0 appendix](#phase-0-appendix--shipped-mvp).

**Phase 1 — Foundation — in flight.** Decomposing the spec into the file model defined in [FILE-MODEL.md](./FILE-MODEL.md), switching persistence from localStorage to GitHub, monorepo restructure into `@ux4/core` / `@ux4/browser`, multi-provider model config.

**Target ship date: November 2026** for the Awaaz pilot loop; **December 2026** for course-prep polish; **course launch January 2027**.

## What's being built

UX4 is a **Behavioral IDE for Conversational Agents**: visual spec authoring + Git-shaped collaboration + Python testing + a client share view, with multiple runtime targets behind a single durable spec. Four coordinated surfaces:

- **Visual authoring (browser editor).** Canvas-first authoring of specs in a UX4 project. GitHub-backed persistence. Today also: chat panel for LLM-assisted authoring, simulate panel for ad-hoc text-mode iteration. Tests tab (Phase 2) for schema-aware JSON editing of testing artifacts.
- **Git-shaped collaboration (per-agent repos).** Hold the decomposed spec, testing artifacts (`tests/`), gold-standard transcripts, result history (`tests/runs/`), models config, and the Python scripts that run tests. File decomposition is by stakeholder concern; see [FILE-MODEL.md § Why decompose](./FILE-MODEL.md#why-decompose).
- **Python testing surface (vendored scripts).** Vendored into each agent repo by `ux4-init-project`. Drive test execution against compiled system prompts, deployed endpoints, or captured production sessions. Built-in evaluators + custom Python evaluators. Persona-driven LLM-simulated users. Nikunj adapts them with Claude Code.
- **Client share view (Phase 3).** Static read-only export to GitHub Pages; agency-client surface for spec walkthroughs without GitHub accounts.

GitHub is the system of record. UX4 holds no server-side state in the free tier.

**Pluggable runtimes.** The spec is the durable artifact; runtimes are interchangeable consumers. Today's runtime is the canonical Python runner (Pipecat-on-the-runner for Awaaz's voice production). Pipecat-direct, LangGraph, OpenAI Agents SDK, and a hosted UX4 runtime are post-MVP targets gated on [TRANSLATION-POC.md](./TRANSLATION-POC.md) confirming behavioral fidelity. MVP testing runs against compiled system prompts (a different compile target), explicitly trading graph-execution fidelity for portability and zero-runtime-dependency iteration.

### Why system-prompt-based testing for MVP

Testing exercises the spec by compiling it to a monolithic system prompt + tool schemas (the existing TS codegen in [lib/codegen/promptGenerator.ts](./lib/codegen/promptGenerator.ts)), then driving an LLM through the test case's user turns with mock-bound capability dispatch. The Python runner is **not** involved in MVP testing.

This buys two things:

- **Simpler Phase 2.** No runner test-mode hook, no SDK changes, no mock injection plumbing across repos. Scripts call the LLM API directly.
- **Honest fidelity story.** System-prompt testing covers LLM-level behavior — *what would the LLM do given this prompt* — not graph-level execution (interrupts, stack semantics, transitions). For MVP this is acknowledged tradeoff.

Runner-based testing (and Pipecat compilation) lands **after** [TRANSLATION-POC.md](./TRANSLATION-POC.md) confirms behavioral fidelity between system-prompt path and graph-native runtimes. That work is post-MVP.

### Success criterion

Awaaz uses the MVP for real production work by November 2026:

- Nirja and Aditya author specs in the browser editor.
- Testing artifacts (test cases, mocks, rubrics, personas) live as JSON files in the agent repo, authored via IDE / Claude Code / GitHub web UI as appropriate.
- Nikunj runs Python scripts (likely modified with Claude Code) for test execution, suite runs, and validation.
- Their work flows through Git repos following UX4 conventions.

If Awaaz uses it for real work, MVP shipped. If they only demo with it, it didn't.

## Architecture

```
┌──────────────────┐         ┌──────────────────┐
│  Browser editor  │         │  Python scripts  │
│  (authoring +    │         │ (vendored per    │
│   simulate)      │         │  agent repo)     │
└────────┬─────────┘         └────────┬─────────┘
         │                            │
         └──────────┬─────────────────┘
                    │
         ┌──────────▼───────────┐
         │   @ux4/core (TS)     │
         │  files, schema,      │
         │  compile, validate   │
         └──────────┬───────────┘
                    │
              ┌─────▼─────┐
              │  GitHub   │
              │ (per-agent│
              │   repos)  │
              └───────────┘
```

The Python `uxflows-runner` sits outside this picture in MVP — it remains canonical for production execution (Awaaz already runs it), but MVP testing doesn't involve it.

**Repo structure**:

- **This repo (`uxflows/`)** becomes a monorepo with `@ux4/core` (pure TS: files, schema, codegen) and `@ux4/browser` (the existing Next.js editor).
- **`uxflows-runner/`** — untouched in MVP. Remains canonical for production.
- **Per-agent Git repos** — owned by the customer (Awaaz). Contain the decomposed spec, testing artifacts, scripts. Created by `ux4-init-project`.

## Implementation phases

### Phase 1 — Foundation (June through mid-July 2026)

**Goal**: file model + GitHub-backed authoring + multi-provider model config.

- **Monorepo workspace setup**: split this repo into `@ux4/core` (pure TS) and `@ux4/browser` (Next.js).
- **File model implementation** per [FILE-MODEL.md](./FILE-MODEL.md): id-indexed loader, per-file schemas in `@ux4/core/schema`, cross-file reference resolution, validation against resolved spec.
- **CLI migration script**: `ux4-init-project --from <spec.json>` splits an existing single-file spec into the decomposed layout. No in-editor wizard — Tapan runs the migration manually for existing specs.
- **GitHub OAuth + Octokit file I/O**.
- **Project initialization** in an empty repo (writes `ux4.json` + directory skeleton + `README.md`).
- **Persistence switch** from localStorage to GitHub-backed via `@ux4/core/files`. localStorage stays as a session-state cache.
- **Inline schema validation** — extend the existing AJV pipeline to the per-file schemas. Errors render where the user is editing.
- **`models/` schema + loader** — the file-model side of multi-provider config: schemas for `models/*.json`, loader aggregation, project-default resolution. Built-in providers (`anthropic`, `openai`, `google`) registered in `@ux4/core`. Simulate and chat panels stay on BYOK Google in Phase 1; provider-adapter wiring lands in Phase 2 when the test scripts also need LLM dispatch.
- **Documentation**: file model, project conventions, migration guide.

Phase 1 doesn't ship: deep graph validation (deferred to Phase 3 — pull in if Awaaz hits a deadlock during pilot); per-file-type form editors (Phase 2 schema-aware JSON editor covers the floor); browser test surfaces (Phase 2). Multilingual support already shipped in Phase 0; Phase 1 testing confirms it survives the CSV + GitHub round-trip as part of normal regression, not as a separate deliverable.

**Anthropic CORS verification** — week 1 task. If browser-direct LLM calls are blocked, decide on workaround.

**Deliverable**: user connects GitHub → opens or initializes a UX4 project → edits the spec visually (flows decomposed into files under the hood) → saves → sees per-concern commits in their GitHub repo. Simulate and chat panels continue to work as in Phase 0 (BYOK Google); multi-provider lands with the testing path in Phase 2.

### Phase 2 — Testing surface (mid-July through September 2026)

**Goal**: per-id JSON file types for testing artifacts + Python scripts that run tests against compiled system prompts + basic result viewer.

- **Per-id schemas** in `@ux4/core/schema` for: test case, capability mock, rubric, persona, result, run manifest. Each carries a `$schema` URI.
- **Loader discovery** for the `tests/` directory — slots these into the same id-indexed symbol table the spec uses. Cross-file references (test case → rubric, test case → mock by capability id, test case → persona) resolve through it.
- **Node CLI**: `ux4-compile --target system-prompt <spec>` emits the compiled monolithic prompt + tool schemas as JSON to stdout. Reuses the existing codegen in `@ux4/core`.
- **Python scripts** vendored per agent repo by `ux4-init-project`:
  - `run_test.py [--target spec|endpoint] <test_case_path>` — runs one test case. Default target `spec`: compiles spec, drives LLM through user turns, dispatches mocks, runs evaluators. Target `endpoint`: hits an existing agent endpoint (URL + auth via env vars `AGENT_ENDPOINT_URL`, `AGENT_ENDPOINT_TOKEN`), no mocks. Either path writes `tests/runs/<timestamp>-<label>/<test-case-id>.result.json`.
  - `run_suite.py [--target spec|endpoint] <test_cases_glob>` — same loop over a glob.
  - `validate.py <path>` — validates artifacts (file or directory) against their schemas via a small Node wrapper around `@ux4/core/schema`.
  - Each script is <150 lines with a documented header explaining what to modify. Nikunj adapts them with Claude Code.
- **Endpoint-based testing** (subsumes whatsupp2's existing capability). Same evaluator library runs against either spec-driven or endpoint-driven transcripts; the script driver is what changes. Mock bindings ignored in `--target endpoint` mode (the endpoint has its own capability implementation). Multiple endpoints supported via env-var conventions; no project-level endpoint registry in MVP.
- **Multi-provider LLM dispatch** lands here too (carry-over from Phase 1's `models/` schema work). Provider adapters (`anthropic`, `openai`, `google`, `openai-compatible`) in `@ux4/core/providers`; env-var resolution for keys and base URLs; simulate and chat panels rewire to read from `models/`. Python scripts use the same provider abstractions via the Node CLI.
- **Evaluator library — Python, vendored.** `tests/evaluators/*.py` files; each exports `evaluate(transcript, config, llm_client=None) -> EvaluatorResult`. `ux4-init-project` vendors the built-ins:
  - `forbidden_phrases`
  - `required_phrases`
  - `max_turn_length`
  - `regex_match`
  - `llm_judge` (loads referenced rubric from `tests/rubrics/`, substitutes `{transcript}` + `{criteria}` + optionally `{gold_standard}`, calls LLM, parses score + reasoning)
  Users add custom evaluators by writing `tests/evaluators/<name>.py` following the same signature. Test cases reference any evaluator by `type` field — built-in and custom dispatch the same way.
- **Gold-standard workflow.** Reference transcripts captured as `tests/gold-standards/<test_case_id>.gold.json` (same shape as a result file). Initially generated by `python run_test.py --save-as-gold <case>` — runs the test and promotes its result to the gold-standards directory. Editable thereafter through the Tests tab JSON editor like any other artifact (fix typos, refine the reference behavior, etc.). Future runs compare via an `llm_judge` evaluator whose rubric references `{gold_standard}` in its prompt template. No separate evaluator type — gold standards are an input to rubrics, not a parallel mechanism. Only LLM judging makes sense for conversation comparison anyway; exact-match and embedding similarity don't survive nondeterministic LLM output.
- **Two test-case user modes — explicit turns and LLM-simulated turns.** The test case's `scenario.user` is either `{ turns: [...] }` (deterministic, regression-style) or `{ persona_id, goal, max_turns }` (an LLM plays the user). Personas become load-bearing: backstory and traits drive the simulated user's behavior. Subsumes whatsupp2's persona-driven simulation. Orthogonal to `--target`: both user modes work against `spec` or `endpoint` driver. Test cases declare their user mode; the script handles whichever is present.
- **Result viewer** in the browser: reads result files from `tests/runs/`. Displays transcript with role labels, capability calls inline (mock id + inputs/outputs), evaluator results with pass/fail and reasoning, metrics, final variable state. MVP scope: view in-session result + view a specific committed run by path. Cross-run comparison is post-MVP.
- **Save results to repo**: user-initiated commit. `tests/runs/<timestamp>-<label>/` directory; gitignored is *not* the default — committed runs are the audit trail.
- **Tests tab in the editor + schema-aware JSON editor.** A new navigation surface in the browser editor surfaces everything under `tests/` from the loader — authoring artifacts (test cases, mocks, rubrics, personas) and gold standards for editing, plus run history for review. Editable artifacts click → schema-aware JSON editor (one component; TypeBox schemas drive autocomplete, validation, and error highlighting); save → commits via the existing GitHub persistence layer. Gold standards edit the same way (initially captured via `--save-as-gold`, then refined manually as the reference behavior evolves). Run results are read-only and feed into the existing result viewer. Single editor component covers all editable file types; no per-file-type forms. Accessibility win without form-per-type cost.

**Deliverable**: user authors a capability mock, a test case, a rubric, a persona as JSON files — either in the editor's Tests tab (schema-aware JSON edit) or in their IDE / Claude Code / GitHub web UI. Runs the test via `python run_test.py <case>`. Sees results in the browser via the result viewer. Optionally commits results. Multi-provider works end-to-end through the testing path.

### Phase 3 — Awaaz pilot + polish (October through November 2026)

**Goal**: Awaaz adopts MVP for real production work; iterate based on feedback.

- **Awaaz pilot**: Nirja and Aditya in the browser editor; Nikunj in Claude Code with the vendored Python scripts. They run their actual production-bound work through UX4 conventions.
- **Iterate** based on Awaaz feedback. Friction in the test-authoring flow is the most likely source; pull in per-file-type forms if the schema-aware JSON editor isn't enough.
- **Client share view** (strategic, requested by Nirja). Read-only canvas mode hiding simulate/chat/testing/scripts/configs chrome. Editor "Publish share view" button generates a static bundle and pushes to a designated branch (e.g., `gh-pages` or `share/`); GitHub Pages serves it as a public URL. Clients view without GitHub accounts. Hides engineering detail (`$schema` URIs, ids, internal plumbing); shows flows, agent meta, capability declarations, guardrails, scripts, and the existing `notes` field on flows and exit_paths (rendered as guided-walkthrough context — designers write notes knowing clients will see them). Always reflects main branch (no snapshot pinning in MVP). Strategic agency-client relationship surface.
- **Production session import** — closes the design → production → regression loop without building observability infrastructure. Two scripts:
  - `python import_session.py <session_log>` — converts a captured runner event log into a `tests/cases/<auto-id>.test.json` with user turns extracted. Designer fills in evaluators afterward and can `--save-as-gold` to lock the behavior.
  - `python eval_session.py <session_log> --evaluators <ids>` — runs configured evaluators directly against a captured transcript, no test case framing. Produces a result file. "Evaluate this conversation."
  - Format: runner-emitted event stream. UX4 parses it; doesn't define it.
- **Browser polish**: id rename with cascade update; scripts sheet row reorder if Awaaz hits it; result viewer refinements based on actual use.
- **Error handling, edge cases, polish** across the editor and scripts.

**Deliverable**: MVP shipped. Awaaz using for real production work.

### Phase 4 — Course prep (December 2026)

**Goal**: ship-ready for the January 2027 course launch.

- **System prompt export polish**: Phase 0 codegen already exists; refine and document for the course. This is the lowest-friction path for course students (paste into Claude, OpenAI, or any LLM with system-prompt support).
- **Public tutorial docs**: walkthroughs of authoring → testing → export. Worked example end-to-end.
- **Beta readiness**: any auth/access flow needed for opening UX4 to public sign-ups (modest; users connect their own GitHub).

Templates, onboarding UI, and Pipecat compilation are **deferred**. They land when (a) the Awaaz pilot validates the loop and (b) the course launch surfaces real demand for them, not before.

**Deliverable**: course can launch.

## Critical decisions to verify or make early

1. **Anthropic CORS policy for browser-side calls.** Verify week 1 of Phase 1. If browser-direct calls are blocked, need a workaround (thin proxy, companion Node process, etc.).
2. **`@ux4/core` codegen reuse from Python**. Python scripts shell out to a Node CLI (`ux4-compile --target system-prompt`). Node becomes a required dependency for the per-agent script environment alongside Python. Acceptable; Awaaz has both.
3. **API key storage in the browser**. Env vars are the source of truth on dev/scripts side. For the browser, paste-and-store-in-localStorage with a clear warning about origin-script exposure. Decide based on Awaaz's risk tolerance. See [FILE-MODEL.md § Models and providers](./FILE-MODEL.md#models-and-providers).
4. **Result file naming and run folder structure.** Single result file per test case in a run, named by test case id. Run folder `<timestamp>-<label>`. Two logical runs produce two folders.
5. **Mock dispatch in the system-prompt path.** Since testing happens against a compiled system prompt, mocks aren't dispatched on graph exit transitions — they're dispatched when the LLM invokes a tool. The capability's `outputs` shape is the contract; mocks return objects matching it. The runner's exit-transition semantics aren't exercised in MVP (that's the fidelity gap; see TRANSLATION-POC).

## Still deferred (post-MVP)

Each has been considered and deferred. Some carry over from Phase 0's Beyond-MVP list; some moved out of the new vision during scope cutting.

### Gated on TRANSLATION-POC

- **`ux4-compile --target pipecat`.** Pipecat compilation as a runtime target. Gates on [TRANSLATION-POC.md](./TRANSLATION-POC.md) confirming fidelity between the spec and graph-native runtimes.
- **Runner-based testing.** Mock-injection hook in `uxflows-runner/`, Python SDK `runner.run_test(spec, test_case, mocks)`, scripts that exercise the *graph* not the system prompt. Same gate.
- **Conformance test suite** that runs the same spec + test case through system-prompt path and runner path and asserts equivalence.

### Deferred for scope

- **Pipecat deploy tooling** (`ux4-deploy-pipecat`). Deployment is platform-specific and substantial; Awaaz deploys themselves.
- **Browser-native test case / mock / rubric / persona editors as forms.** Phase 2 ships a schema-aware JSON editor that covers all four file types with autocomplete and validation. Per-file-type rich forms (mock behavior-type forms, evaluator-builder UI, rubric template highlighting) land if the JSON editor isn't enough for Awaaz's actual workflow.
- **Client-comment infrastructure for the share view.** Phase 3 ships the share view with designer-authored `notes` rendered as guided context but no interactive comment surface. Adding comments needs either GitHub-account auth (loses non-technical clients) or a UX4-hosted proxy (breaks the "no server-side state" stance). Decide post-pilot when there's data on actual client-feedback workflows. Likely Cloudflare-Worker proxy posting structured GitHub Issues if it lands.
- **TS execution engine** in the browser (a TS port of the Python runner). The system-prompt testing path covers MVP; TS engine lands when browser-direct test execution becomes a real audience need.
- **Result viewer comparison view** (side-by-side runs).
- **Cross-run regression detection automation**.
- **Templates / vertical templates** (banking, healthcare, insurance, etc.). Phase 4 ships course-launch without templates; add when course demand surfaces.
- **Onboarding flow for first-time users**. Phase 4 ships without; Awaaz pilots don't need it.
- **System-prompt template on the agent** (`agent.system_prompt_template` with `{{double-brace}}` placeholders). Deferred pending real templates from Nikunj.
- **Steps editor**: structured turn sequencing, captures, per-turn conditions, utterance variations. Schema version bump when implementation pressure is real ([SCHEMA.md § Open Questions](./SCHEMA.md#open-questions)).
- **Schema additions**: `tool` step, `call` step, runtime hints. Schema version bumps.
- **Accumulator / reducer semantics on variables, human-in-the-loop pause, async interrupts, intent catalog, turn budgets.** Open Questions in SCHEMA.md.
- **Skip dagre re-layout when topology hasn't changed.** Perf optimization that matters at 100+ flows. Defer until reported.
- **Knowledge-coverage-gaps heuristic** (the second deep validation check). Imprecise, hard to tune. Keep the unreachable-calc-exit check; defer this one.
- **`language_consistency` and `flow_reached` evaluators.** Add if Awaaz asks by name.
- **Export as text — multiple formats** (declarative YAML, imperative pseudocode, markdown narrative). Read-only by default.
- **Versioning of specs and guardrails** beyond Git's native versioning.
- **Real-time collaboration.** UX4 is a Git-shaped product; real-time would be a different product. Not on the roadmap.
- **Server-side execution, comparison engine, regression detection automation.** Paid tier 2027.
- **Production observability infrastructure**: real-time event-stream consumption, dashboards, metrics aggregation, alerting, log retention, multi-session analytics. The runner emits an event stream; whatever monitoring Awaaz needs lives in their ops stack. Phase 3 ships one-shot session import for the regression-loop use case; the broader observability surface stays out of UX4.
- **Multi-user organizations beyond GitHub's native collaboration.** Paid tier.
- **Runtime adapters beyond `spec-direct`**: LangGraph, OpenAI Agents SDK, Dialogflow CX. Post-MVP.
- **Voice testing.** Months 9-15.
- **Eval-on-canvas overlay.** Findings overlaid onto canvas; post-MVP UX4 surface.

## Documentation deliverables

In order of dependency:

1. **[FILE-MODEL.md](./FILE-MODEL.md)** — project conventions and on-disk layout.
2. **[SCHEMA.md](./SCHEMA.md)** — spec data model.
3. **Per-file schema docs** — one per file type (capability declaration, capability mock, test case, persona, rubric, result, run manifest, etc.), following SCHEMA.md's style.
4. **Browser user guide** — connect repo, init project, author spec, run simulate, view results.
5. **Scripts user guide** — what each script does, environment setup (Python + Node), how to adapt with Claude Code.
6. **Library API reference** — generated from TS types with hand-written examples.
7. **Course tutorial path** — Phase 4 deliverable: walk a student from "open UX4, author flow, export system prompt" in 30 minutes.

## Success metrics

- Awaaz adoption for real production work (binary).
- Test cases authored across Awaaz projects.
- Capability mocks authored.
- Result files committed to Git (proxy for iterations the user wanted to keep).
- Whether Nikunj uses reference scripts as-is, modifies them, or ignores them.
- Iteration loop latency: edit spec → see test result. Target under 30 seconds for typical cases.
- Course student adoption when course launches January 2027.

## Notes for the implementation team

The schema is the durable artifact. The file model is the serialization. Don't modify the schema to accommodate file-layout concerns; if something feels like it belongs in the schema, the test is whether the Python runner needs it. If only the editor or scripts need it, it's a file-layout concern.

System-prompt-based testing is *good enough* for MVP, not equivalent to graph execution. The fidelity gap is acknowledged and tracked by [TRANSLATION-POC.md](./TRANSLATION-POC.md). Don't paper over it.

GitHub is the system of record. UX4 has no opinion about user data persistence beyond "write files to the user's repo on save." If the user disconnects UX4, their work is intact.

The Python scripts are reference implementations, not products. Don't grow them. If users need richer scripts, they adapt these with AI coding assistance — that's the design.

The MVP ships in ~6 months from May 2026 (Awaaz pilot completes November). Course-ready ships +1 month. Scope discipline matters more than feature ambition. If something on the deferred list looks essential mid-build, weigh hard before pulling it in.

---

## Phase 0 appendix — shipped MVP

The original uxflows MVP, shipped 2026-05-08. Listed here as historical record; the work has been absorbed into the broader vision above.

**Eleven chunks shipped:**

1. Drag nodes + persist positions
2. Spec state management (zustand)
3. Import / export + autosave + Ajv + TypeBox
4. Flow inspector
5. Scripts sheet
6. Edge inspector
7. Agent surfaces — shipped as per-concern toolbar modals, not the originally-specced persistent sidebar
8. Add / delete flows + drag-to-connect
9. Basic graph validation
10. Interactive LLM chat (BYOK Google) — 2026-05-02
11. Simulate panel (text chat against the runner) — 2026-05-04

**Also shipped beyond the original plan:** variables editor, tables CRUD, `entry_flow_id` picker, delete buttons in inspectors, schema-doc sync, AGENT-SPEC-PROMPT.txt rewritten for one-shot JSON output, Simulate variables form with LLM-powered value generation, system-prompt codegen ([lib/codegen/promptGenerator.ts](./lib/codegen/promptGenerator.ts)), canvas highlight of active flow + last-traversed edge during simulate.

**Design decisions made during Phase 0** — still load-bearing; read these before changing the editor:

- **Canvas is canonical.** Text views are entry/export only; never a live mirror of the spec. Re-importing replaces; we don't merge text edits back into a live graph.
- **Agent surfaces are per-concern modals**, not a persistent sidebar.
- **Chat is a peer authoring surface, not a copilot.** Chat tool-calls mutate the same zustand store the inspectors do.
- **`flow.example` is annotation-only.** Plain-text transcript; runtimes ignore.
- **Personas, channels, user segments removed from agent envelope.** Out-of-spec concerns.
- **MVP flows use `instructions` + `scripts`**, not structured `steps`. Steps deferred to a future schema version bump.
