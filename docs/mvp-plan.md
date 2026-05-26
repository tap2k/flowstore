# flowstore MVP Plan

The organizing vision and staged operational plan for flowstore. For the data-model contract see [SCHEMA.md](../SCHEMA.md); for the on-disk layout see [FILE-MODEL.md](../FILE-MODEL.md); for architectural rationale see [AGENTS.md](../AGENTS.md); for the translation/fidelity experiment that gates runner-based testing see [TRANSLATION-POC.md](./translation-poc.md); for the systems view of the client-materials → spec → tests → targets loop and what would be required to make it self-optimizing see [docs/optimization-loop.md](./optimization-loop.md); for the Phase 2 plan that consolidates the test-loop work (test-case dropdown + capture in SimulatePanel, run manifests, `final_variables` assertions, result viewer, rubric-driven judge evaluators) see [TESTING-LOOP-PLAN.md](./testing-loop-plan.md).

---

## Status (2026-05-24)

**Phase 0 — original flowstore MVP — shipped 2026-05-08.** Visual editor for v0 specs: canvas authoring, schema-driven inspectors, scripts sheet with multilingual columns, simulate panel, system-prompt codegen, AJV validation, LLM-assisted authoring. Details in [Phase 0 appendix](#phase-0-appendix--shipped-mvp).

**Phase 1 — Foundation — in flight.**

Landed on `main`:
- **1a** Monorepo split into `@flowstore/core` + `@flowstore/browser` (npm workspaces; Next.js consumes core via `transpilePackages`).
- **1b** File-model loader + decomposer in `@flowstore/core/files` (`decomposeSpec`, `loadProject`, Node fs adapter). Single-agent shape, file-form collections, knowledge tables + glossary, per-flow `.flow.json` + `.scripts.csv` pairs. Round-trip lossless on `coffee.json` and the three Tala DPD31 variants (bilingual/en/es). Codegen-equivalence check asserts the compiled system prompt is unchanged across decompose/load.
- **1c** GitHub-backed persistence end-to-end:
  - `@flowstore/core/files/github` adapter — atomic multi-file commit via Git Data API; `expectedCommitSha` optimistic concurrency; empty-repo init; `ConflictError` on ref-advance.
  - Settings sheet — GitHub PAT input + Test connection button.
  - Toolbar icon buttons — Open from GitHub / Save / Refresh, with a "Save to a new branch…" item in the Save dropdown. Conflict modal on save races.
  - Header subtitle shows `<owner>/<repo>@<branch>` when a GitHub project is loaded.
  - `github-init` CLI — push an existing single-file spec into a real repo (same library path as in-editor init).
- **1d** `flowstore-init-project --from <spec.json> --target <dir>` CLI + `round-trip` / `round-trip-disk` verification scripts. Same decomposition library powers the editor's GitHub init path.
- **1g** `models/` schema + loader. `flowstore://models/v0` defines `{ models, default, roles }` with free-form string keys (no `providers` map, no `kind` enum — schemas validate shape, not value membership). Loader merges `models/*.json` files; `resolveModel` walks the precedence chain (built-in default → project default → role → agent default → override). Built-in data carries the four currently supported Google models (Gemini 2.5 / 3.x preview). No runtime consumer yet — Simulate/chat panels stay BYOK Google in Phase 1; provider-adapter wiring lands in Phase 2.
- **1h** `agent.default_model` on the agent schema. Slots into the `resolveModel` precedence chain between project role and explicit override. (An earlier sibling, `agent.system_prompt_template`, was shipped and later removed once it became clear it was export-time decoration on one target rather than spec behavior — no specs used it.)
- **1f** Per-file AJV validation in the loader for `flowstore.json`, `models/*.json`, `knowledge/glossary.json`, `knowledge/tables/<id>.meta.json` — errors flow through `LoadError[]`. New `KnowledgeTableMetaSchema` (flowstore://knowledge-table/v0). `validateGraph` extended with an optional `modelIds` set so callers can flag `agent.default_model` referencing an unknown model id. Existing canvas inline display (per-flow red border + tooltip, per-edge red stroke) continues to surface dangling references unchanged.

**Phase 1 closed.** Phase 2 (testing surface, comments, etc.) begins from here.

**Phase 2 — Testing surface — kicked off (2026-05-24).**

Landed on `main`:
- **2F-partial** Multi-provider LLM dispatch in the browser. CORS verified: OpenAI direct works; Anthropic blocks browser origins, so Claude routes via OpenRouter. Three adapters in `@flowstore/core/llm/providers/`: `google` (existing), `openai` (native chat-completions), `openai-compatible` (shared base, configurable `base_url`). `ModelEntry` extended with optional `endpoint` + `model_id`; `EndpointId` union covers `google`, `openai`, `openrouter`, `openai-compatible` (catchall). `resolveDispatch(modelId)` walks the precedence chain and returns provider + key + base URL + wire id. Settings sheet gains OpenAI + OpenRouter key rows alongside Google. Shared `ModelPicker` filters by which keys are present (with `showUnconfigured` escape hatch for AgentSheet's spec-level default-model picker and runner mode). Built-in catalog expanded: GPT-5.5/5.4/5.4-mini (native); Claude Opus 4.7 / Sonnet 4.6 / Haiku 4.5 (via OpenRouter); Grok 4.3, DeepSeek V4 Pro/Flash/V3.2, Kimi K2.6, Qwen 3 235B, Llama 4 Maverick, Llama 3.3 70B (free), Nemotron 3 Super 120B (free), Owl Alpha (stealth, free) — all via OpenRouter. Gemini-only authoring helpers (✨ Generate variables/mocks/persona, transcript translate) pinned to a Gemini default regardless of the picker (Google structured-output API; multi-provider structured output is a separate ticket). The `runner` side of the multi-provider story — Python scripts using the same adapters via a Node CLI — remains pending.
- **Latency display in SimulatePanel.** Wall-clock dispatch latency (prompt-mode LLM call + runner round-trip) renders below each agent bubble. Additive `latencyMs?` field on `TranscriptTurn`.
- **Comments anchored to flows.** Per-uuid additive files at `comments/<uuid>.comment.json` (`flowstore://comment/v0`). Flat threading (no replies), resolve flips `resolved: true` rather than deleting (Git-shaped audit trail kept). `CommentsSection` lives at the bottom of `FlowInspector`; small amber unresolved-count badge on each flow node on the canvas. Writes use GitHub's Contents API (`PUT /contents/{path}`) so concurrent posts serialize cleanly — `mode: "create"` for new comments skips the existence probe, `mode: "update"` for resolve/reopen fetches the current blob sha. v1 anchor enum is `flow` only; broaden when designers ask. Author is hardcoded to `"user"` until a `gh api /user` echo lands on PAT save.

Still ahead in Phase 2 (see [TESTING-LOOP-PLAN.md](./testing-loop-plan.md) for sequencing):
- **O-1** `state_check` evaluator + `final_variables` assertions on the testing-script side. *Runner-deferred → currently no-op; revisit when runner is the testing path.*
- **I-1 / I-2** Test-case dropdown + capture-as-test-case in SimulatePanel.
- **O-2** Run manifest + inter-run diff.
- **O-3** Result-file viewer in SimulatePanel.
- **O-4** Rubric judge wired into the harness (load-bearing for semantic eval).
- Id-rename cascade and concurrent-edit detection — pilot-hardening, pulled in if Awaaz hits the friction.
- Multi-provider dispatch on the Python scripts side (`@flowstore/core` providers shared via Node CLI).
- Native Anthropic adapter — deferred until Anthropic relaxes CORS or a proxy lands; Claude works via OpenRouter today.
- Comments: replies/threading, anchor kinds beyond flow, real author identity from `gh api /user`. Pull in if pilot surfaces the friction.

**Design decision — ids are immutable from the editor UI.** Stable ids are the cross-file reference contract; the file model and codegen assume they don't change under live edits. The editor never surfaces an "edit id" field; ids are produced either by prompts/AGENT-SPEC-PROMPT.txt (semantic, e.g. `identity_confirmation`) or by the editor's `genId` (opaque, e.g. `flow_a3f2b8c1`). Renaming an id requires manual JSON edits via Claude Code or the GitHub web UI plus a manual reference sweep. Cascade-rename UI (Phase 2.I in the original plan) is deferred until pilot feedback shows designers actually need it; until then the constraint reduces an entire class of "dangling reference after rename" bugs to zero by construction.

**Target ship date:** November 2026 for Awaaz pilot loop; December 2026 for course-prep polish; course launch January 2027.

## What's being built

flowstore is a **Behavioral IDE for Conversational Agents** — the open, Git-backed development section of the agent pipeline. Runtime execution (Python runner today; Pipecat / LangGraph / etc. post-MVP) and production observability (handled by the runtime's event stream and dedicated tools like LangSmith, Cekura, Maxim) are separate concerns. flowstore may integrate with production-monitoring tools post-pilot, but those integrations are not in MVP.

**Four coordinated surfaces over a single durable spec:**

- **Visual authoring (browser editor).** Canvas-first authoring of one or many agents in a flowstore project. GitHub-backed persistence. Chat panel for LLM-assisted authoring, simulate panel for live exploration. Extended in Phase 2 for test-case loading, persona-driven runs, mock binding, and capture-as-test-case.
- **Git-shaped collaboration (per-agent or multi-agent repos).** Decomposed by stakeholder concern per [FILE-MODEL.md](../FILE-MODEL.md). One repo can hold many agents (Tala with N purposes × M languages) with shared capabilities, guardrails, knowledge, personas, evaluators, and rubrics. Comments are first-class additive files anchored to spec entities.
- **Python testing surface (vendored scripts).** `run.py` drives test execution against compiled system prompts, deployed endpoints, or captured production sessions. Built-in evaluators + custom Python + LLM-judge rubrics. Personas as user-side system prompts; gold standards as reference transcripts. Vendored per agent repo so Nikunj adapts with Claude Code.
- **Client share view (Phase 3).** Static read-only export to GitHub Pages — agency-client surface for spec walkthroughs without GitHub accounts.

**Pluggable runtimes.** The spec is the durable artifact; runtimes are interchangeable consumers. Today's canonical runtime is the Python runner (Pipecat-on-the-runner for Awaaz's voice production). Pipecat-direct, LangGraph, OpenAI Agents SDK, hosted flowstore runtime — all post-MVP, gated on [TRANSLATION-POC.md](./translation-poc.md) confirming behavioral fidelity. MVP testing runs against compiled system prompts, explicitly trading graph-execution fidelity for portability and zero-runtime-dependency iteration.

GitHub is the system of record. flowstore holds no server-side state in the free tier. A hosted SaaS tier — for non-tech audiences who need real-time collaboration without Git fluency — is a coherent post-MVP product extension, not MVP scope.

### Success criterion

Awaaz uses the MVP for real production work by November 2026:

- Nirja and Aditya author specs in the browser editor — one Tala repo containing all purpose × language agents.
- Testing artifacts (test cases, mocks, rubrics, personas) live as JSON files in the agent repo, authored via IDE / Claude Code / GitHub web UI; SimulatePanel handles selection and live exploration.
- Nikunj runs Python scripts (adapted with Claude Code) for test execution, suite runs, validation.
- Comments anchored to spec entities replace ad-hoc Slack discussion of the spec.
- Work flows through Git following flowstore conventions.

If Awaaz uses it for real work, MVP shipped. If they only demo with it, it didn't.

## Architecture

```
┌──────────────────┐         ┌──────────────────┐
│  Browser editor  │         │  Python scripts  │
│  (canvas +       │         │  (vendored per   │
│   SimulatePanel) │         │   agent repo)    │
└────────┬─────────┘         └────────┬─────────┘
         │                            │
         └──────────┬─────────────────┘
                    │
         ┌──────────▼───────────┐
         │   @flowstore/core (TS)     │
         │  files, schema,      │
         │  compile, providers  │
         └──────────┬───────────┘
                    │
              ┌─────▼─────┐
              │  GitHub   │
              │ (per-agent│
              │   repos)  │
              └───────────┘
```

The Python `flowstore-runner` is outside MVP's testing path — Awaaz runs it for production; MVP testing uses compiled system prompts directly.

**Repo structure:**

- **This repo (`flowstore/`)** — monorepo with `@flowstore/core` (pure TS: files, schema, codegen, providers) and `@flowstore/browser` (Next.js editor).
- **`flowstore-runner/`** — untouched in MVP; remains canonical for production.
- **Per-agent / multi-agent Git repos** — owned by the customer (Awaaz). Hold the decomposed spec, testing artifacts, scripts. Created by `flowstore-init-project`.

## Implementation phases

### Phase 1 — Foundation (June through August 2026)

**Goal:** file model + multi-agent support + GitHub-backed authoring + multi-provider model config foundation.

- **Monorepo workspace setup**: split this repo into `@flowstore/core` (pure TS) and `@flowstore/browser` (Next.js).
- **File model implementation** per [FILE-MODEL.md](../FILE-MODEL.md): id-indexed loader, per-file schemas in `@flowstore/core/schema`, cross-file reference resolution, validation against resolved spec, file-or-directory shape rule for collections.
- **Multi-agent support**: `agents/<id>/` directory shape, three-level scope rules (project / agent / flow) for guardrails / variables / business-goals / FAQ, scope-aware loader and compilation, collision-as-error semantics. Single-agent projects stay flat; promote via `flowstore-init-project --add-agent <id>`.
- **CLI migration script**: `flowstore-init-project --from <spec.json>` splits an existing single-file spec into the decomposed layout (defaults to single-agent shape).
- **GitHub OAuth + Octokit file I/O**.
- **Project initialization** in an empty repo (writes `flowstore.json` + directory skeleton + scaffolded `README.md`).
- **Persistence switch** from localStorage to GitHub-backed via `@flowstore/core/files`. Auto-commit to main; no branches surfaced in the editor (engineers branch via CLI if they want). localStorage stays as a session-state cache.
- **Inline schema validation** — extend the existing AJV pipeline to the per-file schemas. Errors render where the user is editing. Cross-file validation surfaces stale references inline (dangling capability ids, persona refs, flow gotos).
- **`models/` schema + loader**: schemas for `models/*.json`, loader aggregation, project-default resolution. `models/defaults.json` carries `default` + optional `roles` map (agent / judge / user_simulation / authoring). Built-in providers (`anthropic`, `openai`, `google`) registered in `@flowstore/core`. Simulate/chat panels keep BYOK Google in Phase 1; provider-adapter wiring lands in Phase 2 alongside script-side LLM dispatch.
- **`agent.default_model`** — optional field on agent schema; overrides project default for this agent's runs.
- **`flowstore.json` is minimal** — just `{ "$schema": "flowstore://project/v0" }`. Agents implicit from filesystem (presence of `agents/` directory); compile targets are CLI flags; project name derived from directory; client lives in `agent.meta.client`.
- **Documentation**: file model, multi-agent project conventions, migration guide.

**Runtime config (STT, TTS, voices, telephony, audio, barge-in, VAD, transport choice) is explicitly out of flowstore scope.** Lives with the runner / Pipecat config / deployment infrastructure. flowstore declares semantic info (e.g. `meta.languages`); runner picks runtime knobs. Optional `runtime/` directory is post-MVP if customers demand it.

**Anthropic CORS verification** — week 1 task. If browser-direct LLM calls are blocked, decide on workaround (thin proxy, companion Node process, etc.).

**Deliverable:** user connects GitHub → opens or initializes a flowstore project (single-agent default; multi-agent via add-agent) → edits specs visually with shared resources at root and per-agent flows under `agents/<id>/` → saves → sees per-concern commits in GitHub. Simulate/chat panels continue working as in Phase 0 (BYOK Google); multi-provider lands with the testing path in Phase 2.

### Phase 2 — Testing surface (mid-August through October 2026)

**Goal:** testing surface complete; persona-driven exploration in browser; comments anchored to spec; multi-provider end to end.

**A. File types & loader:**

- Per-id schemas for test case, capability mock, persona, rubric, result, run manifest, comment. Loader discovery for `tests/` and `comments/`.
- Test cases are scripted only (`user_turns` array; explicit, deterministic). Persona-driven runs live in SimulatePanel for exploration; if a designer wants to lock one as regression, they use capture-as-test-case to extract turns. First-class persona-driven tests deferred until LLM-judge reproducibility is sufficient.
- Personas: minimal schema (`id` + `system_prompt` + optional `name` / `notes` / `model`).
- Test cases / rubrics carry optional `model` field for per-file model pinning (reproducibility of regression tests; impartial judge model). Resolution chain: per-call CLI → env var → per-file `model` → `models.roles.<role>` → `models.default` → built-in.
- Capability mocks paired with capabilities via filename prefix (`capabilities/<id>.<variant>.mock.json`). Project-level; reused across agents.
- Comments: per-uuid files (`comments/<uuid>.comment.json`); additive, conflict-free. Anchor = `{ kind, agent_id?, id }`.
- **Result schema (`flowstore://result/v0`) is producer/consumer contract — additive-by-default.** Lives in `@flowstore/core/src/schema/files/` alongside the input schemas (test-case, persona, rubric, mock). Strict on the load-bearing fields (`$schema`, `test_case_id`, `timestamp`, `transcript`); `additionalProperties: true` at top level so custom harnesses can add fields (`latency_ms`, `token_counts`, runner-only `flow_trace`, judge-only `judge_model`, etc.) without forking the schema. **Asymmetry vs input schemas is intentional**: inputs are sealed contracts, outputs are extensible records. The well-known fields are what the editor's result viewer renders; everything else rides along but isn't surfaced. Same posture as syslog vs request schema, or OpenTelemetry attributes vs span name. Well-known optional fields the editor surfaces: `agent_id`, `model`, `prompt_source` (pivot field), `capability_calls[]`, `final_variables{}`, `evaluator_results[]` (with `name` + either `passed` or `score` + free-form `notes`), `trials[]` (multi-trial mirror of top-level fields), `error`.

**B. SimulatePanel extended (unified browser run surface):**

- Dropdown to load test case → drives `user_turns`.
- Dropdown to load persona → auto-populates user-side system prompt.
- Naked user-side system prompt (paste/edit directly, like the existing agent-side pattern).
- Mock binding via existing Phase 0 pattern, extended for test-case mock_bindings.
- Capture-as-test-case button (extracts user turns from displayed transcript → writes `tests/cases/<auto-id>.test.json`).
- Download transcript to local machine (no commit, no notes UI; designer adds notes externally — email, ticket, doc).
- Renders captured result files (from `tests/runs/`) in the same transcript-display surface.
- **No evaluators run in the browser.** Evaluation is Python's job.

**C. Comments surface in editor:**

- Canvas badge on entities with comments (flow / exit_path / capability / guardrail / test case / mock / rubric / persona).
- Click badge → side panel with thread view.
- Add comment from right-click menu or side panel.
- Reply / resolve via writing new comment files.

**D. Python scripts (vendored per-agent repo):**

- `run.py [--against prompt|endpoint] [--agent <id>] [--personas <glob>] [--evaluators <glob>] [--trials N] [--save-as-gold] <case-or-glob>` — runs one test case or many via glob. Default `--against prompt`: compiles system prompt, drives LLM through user turns, dispatches mocks, runs evaluators. `--against endpoint`: hits an existing agent endpoint (URL + auth via env vars `AGENT_ENDPOINT_URL`, `AGENT_ENDPOINT_TOKEN`), no mocks. Writes results to `tests/runs/<timestamp>-<label>/<test-case-id>.result.json`.
- `--trials N` — run each test case N times (LLM outputs vary). Aggregates pass@k (probability of at least one success) and pass^k (probability of all N succeeding). Default N=1. Critical for any evaluator using LLM-judged rubrics where single-trial results are misleading. Output: result file gets a `trials: [...]` array; aggregate metrics (`pass_at_k`, `pass_caret_k`) per evaluator. Suite summary aggregates across test cases.
- `validate.py <path>` — validates artifacts (file or directory) against schemas via Node wrapper around `@flowstore/core/schema`.
- Each script <150 lines with a documented header. Nikunj adapts with Claude Code.
- File-path-based addressing throughout (no id-based CLI args). Personas / evaluators / test cases all referenced as paths or globs.
- Multi-persona runs: `--personas tests/personas/*.persona.json` runs the test once per persona file matched.

**E. Endpoint-based testing (`--against endpoint`):**

- Same evaluator library runs against either spec-driven or endpoint-driven transcripts.
- Mock bindings ignored in `--against endpoint` mode (endpoint has its own capability implementation).
- Subsumes whatsupp2's existing endpoint-testing capability.

**F. Multi-provider LLM dispatch:**

- Provider adapters (`anthropic`, `openai`, `google`, `openai-compatible`) in `@flowstore/core/providers`.
- Env-var resolution for keys and base URLs.
- Simulate and chat panels rewire to read from `models/` config.
- Python scripts use the same provider abstractions via Node CLI.

**G. Evaluator library:**

- `tests/evaluators/*.py` — Python deterministic checks; built-ins vendored by `flowstore-init-project`:
  - `forbidden_phrases`
  - `required_phrases`
  - `max_turn_length`
  - `regex_match`
  - `state_check` — asserts expected key/value pairs in the test's final variable state. Config: `{ expected: { customer_verified: true, payment_status: "processed", outstanding_amount: { "<=": 100 } } }`. Supports literal equality, basic comparison operators (`<=`, `>=`, `<`, `>`, `!=`), and optional regex via `{ pattern: "..." }`. Pulls from the result file's `final_variables`.
  - `tool_calls_check` — asserts that specific capabilities were dispatched during the test. Config: `{ required: [{ capability: "verify_identity" }, { capability: "process_refund", params: { amount: { "<=": 100 } } }, { capability: "send_confirmation" }], ordered: true | false }`. Parameter constraints use the same operators as `state_check`. Pulls from the result file's `capability_calls` array.
  Users add custom evaluators alongside following the `evaluate(transcript, config, llm_client=None) -> EvaluatorResult` signature.
- `tests/rubrics/*.rubric.json` — llm-judge rubrics (declarative criteria + scoring scale + prompt template). Template supports `{transcript}`, `{criteria}`, `{gold_standard}` placeholders.
- Test cases reference either kind uniformly via `evaluators: ["forbidden_phrases", "empathy_for_short_delay"]`. Loader resolves by name in both directories.

**H. Gold-standard workflow:**

- `run.py --save-as-gold <case>` writes the run's transcript to `tests/gold-standards/<test_case_id>.gold.json`.
- Rubrics whose prompt template references `{gold_standard}` auto-load from the gold standards directory at evaluation time.
- Gold standards editable thereafter — they're just JSON files (fix typos, refine reference behavior).
- No separate evaluator type; gold standards are an input to rubrics, not a parallel mechanism.

**I. Editor concerns:**

- **Id rename with cascade update** — renaming a flow / capability / etc. in the editor finds all references (in test cases, mocks, other flows, comments) and updates them atomically. Addresses Nikunj's "update test cases when schema changes" feedback.
- **Concurrent-edit detection** — file-SHA check on save with "this file changed since you opened it" warning. Prevents silent overwrites.
- **Cross-file validation** surfaces stale references inline (extension of Phase 1 work).
- **Git-aware chat tools (deferred; pull in if pilot friction surfaces).** Today the chat panel's tool surface in [packages/browser/lib/chat/tools.ts](./packages/browser/lib/chat/tools.ts) only mutates the in-memory spec. The Octokit plumbing in [packages/core/src/files/github.ts](./packages/core/src/files/github.ts) (client, `readRepoToFileMap`, `writeFileMapToRepo`, `ConflictError`) plus the `githubProject` store already cover everything needed to surface git operations as chat tools. Read-only first (`github_diff` via `repos.compareCommits`, `github_list_branches`) — ~50 lines, no UX changes, validates whether the LLM can reason usefully about git state. Write side (`github_pull`, `github_merge`, `github_create_pr`) requires a per-tool `requiresConfirmation` flag and an inline approval bubble — the current auto-loop in [ChatPanel.tsx:69-131](./packages/browser/components/chat/ChatPanel.tsx#L69-L131) executes up to 12 tool calls without asking, which is fine for spec edits and unacceptable for branch-level remote writes. Decision deferred: designers branch via CLI today and the Phase 2 testing surface is the load-bearing path; pull in if Awaaz pilots show designers needing branch operations in-editor.

**J. Non-dev framing:**

- Editor (canvas + SimulatePanel) is the surface for designers. Docs don't direct non-devs to IDE / GitHub web UI for normal work. Engineers (Nikunj) use IDE for scripts and JSON editing of testing artifacts; designers stay in the editor.
- Branches / PRs / merge conflicts are engineer concepts; editor never surfaces them.
- No Tests tab in MVP. SimulatePanel dropdowns handle test case + persona file selection. If non-dev pain surfaces, a Tests tab with schema-aware JSON editor + per-file-type forms can land post-pilot.

**Deliverable:** Awaaz designers can author multi-agent specs visually, run persona-driven and scripted tests via SimulatePanel + Python scripts, comment on the spec inline, see results, and use multiple LLM providers. Engineers extend evaluators with custom Python or new rubrics.

### Phase 3 — Awaaz pilot + polish (November 2026)

**Goal:** Awaaz adopts MVP for real production work; iterate; ship the strategic surfaces.

- **Awaaz pilot.** Nirja and Aditya in the browser editor; Nikunj in Claude Code with vendored Python scripts. Tala's full purpose × language lineup as one multi-agent project. Real production work.
- **Iteration based on pilot feedback.** Friction in the test-authoring flow is the most likely source; pull in Tests tab + schema-aware JSON editor + per-file-type forms if the IDE-only path bites for designers.
- **Client share view** (strategic, requested by Nirja). Read-only canvas mode hiding simulate / chat / testing / scripts / configs chrome. Editor "Publish share view" button generates a static bundle and pushes to a designated branch (`gh-pages` or `share/`); GitHub Pages serves it as a public URL. Clients view without GitHub accounts. Hides engineering detail (`$schema` URIs, ids, internal plumbing); shows flows, agent meta, capability declarations, guardrails, scripts, and the existing `notes` field on flows and exit_paths (rendered as guided-walkthrough context — designers write notes knowing clients will see them). Always reflects main branch (no snapshot pinning in MVP). Strategic agency-client relationship surface.
- **Production session import** — closes the design → production → regression loop without building observability infrastructure:
  - `python import_session.py <session_log>` — converts a captured runner event log into a `tests/cases/<auto-id>.test.json` with user turns extracted. Designer fills in evaluators afterward; can `--save-as-gold` to lock behavior.
  - `python eval_session.py <session_log> --evaluators <glob>` — runs evaluators directly against a captured transcript, no test case framing. "Evaluate this conversation."
  - Format: runner-emitted event stream. flowstore parses it; doesn't define it.
- **Deep validation: unreachable calculation exits** — slotted from Phase 1; pull in once pilot surfaces the need.
- **Browser polish** based on actual use: scripts sheet row reorder if Awaaz hits it; result viewer refinements; canvas perf if 100+ flows lag.

**Deliverable:** MVP shipped. Awaaz using for real production work on the Tala project.

### Phase 4 — Course prep (December 2026)

**Goal:** ship-ready for the January 2027 course launch.

- **System prompt export polish** — Phase 0 codegen already exists; refine and document for the course. Lowest-friction path for course students (paste into Claude, OpenAI, or any LLM with system-prompt + tool-call support).
- **Public tutorial docs** — walkthroughs of authoring → testing → export. Worked example end-to-end.
- **Beta readiness** — auth/access flow for opening flowstore to public sign-ups (modest; users connect their own GitHub).

Templates, onboarding UI, Pipecat compile remain deferred. They land when (a) the Awaaz pilot validates the loop and (b) the course launch surfaces real demand, not before.

**Deliverable:** course can launch.

## Critical decisions to verify or make early

1. **Anthropic CORS policy for browser-side calls.** Verify week 1 of Phase 1. If blocked, decide on workaround.
2. **`@flowstore/core` codegen reuse from Python.** Python scripts shell out to a Node CLI (`flowstore-compile --format prompt --agent <id>`). Node becomes a required dependency for the per-agent script environment alongside Python. Acceptable; Awaaz has both.
3. **API key storage in the browser.** Env vars on dev/scripts side. For the browser, paste-and-store-in-localStorage with a clear warning about origin-script exposure. Decide based on Awaaz's risk tolerance.
4. **Mock dispatch in the system-prompt path.** Mocks aren't dispatched on graph exit transitions — they're dispatched when the LLM invokes a tool. The capability's `outputs` shape is the contract; mocks return objects matching it. The runner's exit-transition semantics aren't exercised in MVP (the fidelity gap tracked by TRANSLATION-POC). Unbound capability in spec mode → test fails (not silent default).
5. **Scope collisions in multi-agent.** Same id at project + agent level = error in MVP, not silent override. Designer consolidates.
6. **Cross-agent references in multi-agent.** A flow's `goto` references only its own agent's flows. Project-level entities (capabilities, project-guardrails, personas, etc.) referenceable from any agent. No cross-agent flow references in MVP.

## Still deferred (post-MVP)

Each has been considered and deferred. Defers are pre-conditional, not aspirational — each has a stated trigger.

### Gated on TRANSLATION-POC

- **`flowstore-compile --format pipecat`.** Pipecat as a runtime compile target.
- **Runner-based testing.** Mock-injection hook in `flowstore-runner/`, Python SDK `runner.run_test(...)`, scripts that exercise the *graph* not the system prompt.
- **Conformance test suite** that asserts system-prompt-path and runner-path equivalence.
- **First-class persona-driven test cases** as formal regression units. Currently persona-driven runs live in SimulatePanel for exploration; lock-as-test via capture-as-test-case. Becomes first-class when LLM-judge reproducibility is sufficient to treat them as regression.

### Gated on Awaaz pilot data

- **Tests tab + schema-aware JSON editor in browser.** Designers edit testing artifacts in IDE / GitHub web UI for MVP; ship Tests tab if friction surfaces.
- **Per-file-type rich form editors** (mock behavior-type forms, evaluator builder, rubric template highlighting). Phase 3+ if JSON-in-IDE doesn't suffice.
- **Client-comment infrastructure for the share view.** Phase 3 share view has designer-authored `notes` rendered as context; interactive comments need either GitHub-account auth (loses non-tech clients) or a flowstore-hosted proxy (breaks no-server-state). Decide post-pilot. Likely Cloudflare-Worker proxy posting to GitHub Issues.
- **Result viewer comparison view** (side-by-side runs).
- **Suite-level evaluators** ("apply this rubric to every test in the suite"). Cross-cutting concerns via documentation in MVP; first-class file type post-pilot if needed.

### Gated on broader-audience product expansion

- **Hosted flowstore collaboration tier.** Real-time presence, live cursors, fine-grained per-entity permissions, server-managed state. For non-tech designer audience that finds Git friction prohibitive. Two-tier strategy: open Git tier (MVP) + hosted SaaS tier (paid, post-pilot). Same schema, same file model — different access surface.
- **Cross-project analytics** ("eval pass rate across all my projects"). Hosted-tier feature.
- **Server-side execution, comparison engine, regression detection automation.** Paid tier 2027.
- **Templates / vertical templates** (banking, healthcare, insurance). Phase 4 ships course without templates; add when demand surfaces.
- **Onboarding flow for first-time users.** Phase 4 ships without; Awaaz pilots don't need it.
- **Multi-user organizations beyond GitHub's native collaboration.**
- **Non-GitHub Git backends for browser editing** (GitLab, Gitea/Forgejo, self-hosted bare repos, raw SSH remotes). The file model and CLI are already Git-host-agnostic — only the browser editor is coupled to GitHub, via the ~15-call Octokit surface in [packages/core/src/files/github.ts](./packages/core/src/files/github.ts), all of which are GitHub REST mirrors of plain Git operations (no PRs, Issues, or Apps). Two viable swaps: (a) per-forge adapters (`@flowstore/git-host` interface with `github` / `gitlab` / `gitea` impls — ~1 day each), or (b) one `isomorphic-git` implementation that works against any Git remote (requires a CORS proxy and an auth rework). Trigger: a concrete user (compliance-blocked customer, course participant on self-hosted Gitea, Awaaz extension to GitLab). Today's self-hosters use the CLI against their own Git host and skip the browser editor — that's the unblocked path; this entry is about closing the editor gap.

### Gated on production-monitoring integration demand

- **Integration with production monitoring / eval platforms** (LangSmith, Cekura, Maxim, runtime event stream consumers). Two directions: export flowstore evaluation results into their formats; import production data from them as test cases via session-import equivalents. Defer until pilot data shows which platforms Awaaz and broader audience actually use.

### Gated on LLM-judge wiring

- **Autonomous spec optimization.** The end-to-end loop (client materials → spec + tests → compiled prompt or runtime → diff matrix → revise spec) is structurally amenable to autonomous optimization because the spec is structured and the diff matrix is a real gradient. See [docs/optimization-loop.md](./optimization-loop.md). Gated on LLM-judge rubrics being wired into the runner (substring-only assertions are too narrow a signal), plus run-level aggregation, mechanism categorization on red cells, and a typed spec-mutation API. Human-in-the-loop optimization works today; full autonomy is incremental once the judge is wired.

### Schema and behavioral additions

- **Steps editor**: structured turn sequencing, captures, per-turn conditions, utterance variations. Schema version bump when implementation pressure is real ([SCHEMA.md § Open Questions](../SCHEMA.md#open-questions)).
- **Schema additions**: `tool` step, `call` step, runtime hints. Schema version bumps.
- **Accumulator / reducer semantics on variables, human-in-the-loop pause, async interrupts, intent catalog, turn budgets.** Open Questions in SCHEMA.md.
- **Multi-agent capability isolation** (per-agent allowlist for which project-level capabilities the agent can use). Regulatory pressure trigger.
- **Per-agent model overrides** in `models/` config.
- **TS execution engine** in the browser (TS port of the Python runner). System-prompt testing covers MVP; TS engine lands when browser-direct test execution becomes a real audience need.

### Deferred to whenever pain surfaces

- **Token cost telemetry per model.** `BUILT_IN_MODELS` carries only `name` today. When cost visibility becomes real (eval run budgeting, designer per-turn cost feedback, cross-project spend analytics), extend the model entry with `inputPricePerMTok` / `outputPricePerMTok` and surface in Simulate's lastUsage line + a per-run cost in result files. Data-only change; no schema bump.
- **Skip dagre re-layout when topology hasn't changed.** Perf opt at 100+ flows.
- **Knowledge-coverage-gaps heuristic** (second deep validation check). Imprecise.
- **`language_consistency` and `flow_reached` evaluators.** Add if Awaaz asks by name.
- **Export as text — multiple formats** (declarative YAML, imperative pseudocode, markdown narrative).
- **Versioning of specs and guardrails** beyond Git native.
- **Real-time collaboration.** Git-shaped product; real-time is a different product (the hosted-SaaS tier).
- **Voice testing — acoustic dimension.** Transcript-based voice testing covered via production session import in Phase 3; acoustic (TTS quality, prosody, barge-in) needs audio infrastructure. Months 9-15.
- **Eval-on-canvas overlay.** Findings overlaid onto canvas.

## Documentation deliverables

In order of dependency:

1. **[FILE-MODEL.md](../FILE-MODEL.md)** — project conventions, on-disk layout, multi-agent shapes, scope rules.
2. **[SCHEMA.md](../SCHEMA.md)** — spec data model.
3. **Per-file schema docs** — one per file type (capability declaration, capability mock, test case, persona, rubric, result, run manifest, comment, etc.).
4. **Browser user guide** — connect repo, init project (single or multi-agent), author specs, run SimulatePanel, view results, add comments.
5. **Scripts user guide** — what each script does, environment setup (Python + Node), how to adapt with Claude Code, glob patterns for personas / evaluators / tests.
6. **Library API reference** — generated from TS types with hand-written examples.
7. **Course tutorial path** — Phase 4: walk a student from "open flowstore, author flow, export system prompt" in 30 minutes.

## Success metrics

- Awaaz adoption for real production work on Tala (binary).
- Test cases authored across Awaaz projects (one Tala project, N agents).
- Capability mocks authored.
- Comments threads in the editor.
- Result files committed to Git (proxy for iterations the user wanted to keep).
- Whether Nikunj uses reference scripts as-is, modifies them, or ignores them.
- Iteration loop latency: edit spec → see test result. Target under 30 seconds for typical cases.
- Course student adoption when course launches January 2027.

## Notes for the implementation team

The schema is the durable artifact. The file model is the serialization. Don't modify the schema to accommodate file-layout concerns; if something feels like it belongs in the schema, the test is whether the Python runner needs it. If only the editor or scripts need it, it's a file-layout concern.

System-prompt-based testing is *good enough* for MVP, not equivalent to graph execution. The fidelity gap is tracked by [TRANSLATION-POC.md](./translation-poc.md). Don't paper over it.

Multi-agent compilation: each agent compiles independently. Cross-agent references aren't allowed in MVP. Loader merges project ∪ agent ∪ flow per scope rule into the resolved compiled spec, which has the historical `{agent, flows}` shape — runtime unaware of multi-agent.

GitHub is the system of record. flowstore has no opinion about user data persistence beyond "write files to the user's repo on save." If the user disconnects flowstore, their work is intact.

The Python scripts are reference implementations, not products. Don't grow them. If users need richer scripts, they adapt with AI coding assistance — that's the design.

Comments are additive — adding is always conflict-free. Resolution is also a new file (the resolving comment marks `resolved_by`). Cascade-delete on entity removal handles orphans.

The MVP ships in ~6 months from May 2026 (Awaaz pilot completes November). Course-ready ships +1 month. Scope discipline matters more than feature ambition. If something on the deferred list looks essential mid-build, weigh hard before pulling it in. Most of the time the right answer is: ship without it; iterate post-pilot.

---

## Phase 0 appendix — shipped MVP

The original flowstore MVP, shipped 2026-05-08. Historical record; absorbed into the broader vision above.

**Eleven chunks shipped:**

1. Drag nodes + persist positions
2. Spec state management (zustand)
3. Import / export + autosave + Ajv + TypeBox
4. Flow inspector
5. Scripts sheet
6. Edge inspector
7. Agent surfaces — per-concern toolbar modals (not a persistent sidebar)
8. Add / delete flows + drag-to-connect
9. Basic graph validation
10. Interactive LLM chat (BYOK Google) — 2026-05-02
11. Simulate panel (text chat against the runner) — 2026-05-04

**Also shipped beyond the original plan:** variables editor, tables CRUD, `entry_flow_id` picker, delete buttons in inspectors, schema-doc sync, prompts/AGENT-SPEC-PROMPT.txt rewritten for one-shot JSON output, Simulate variables form with LLM-powered value generation, system-prompt codegen ([packages/core/src/codegen/promptGenerator.ts](./packages/core/src/codegen/promptGenerator.ts)), canvas highlight of active flow + last-traversed edge during simulate.

**Design decisions made during Phase 0** — still load-bearing:

- **Canvas is canonical.** Text views are entry/export only; never a live mirror of the spec.
- **Agent surfaces are per-concern modals.**
- **Chat is a peer authoring surface, not a copilot.** Chat tool-calls mutate the same zustand store the inspectors do.
- **`flow.example` is annotation-only.**
- **Personas, channels, user segments removed from agent envelope.**
- **MVP flows use `instructions` + `scripts`**, not structured `steps`.
