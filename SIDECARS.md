# Sidecars

UX4 separates **behavior** (the spec — agent + flows) from **authoring metadata** (UI state, comments, tests, run history) by colocating both in the same document under distinct top-level keys, each governed by its own `$schema`. Runtimes consume only the behavioral keys; the rest is annotation that rides along for authoring round-trip and is stripped on runtime export.

This document defines the two sidecars: **`ui`** (positions, colors, comment threads, share-view config) and **`tests`** (cases with structured graders + simulated-user contract + reference solutions, response-style library, append-only run history with per-grader verdicts and human annotations, coverage). It also defines the two export modes — **`exportSpec`** (runtime: behavior only) and **`exportAll`** (authoring: everything).

For the behavioral spec these sit alongside, see [SCHEMA.md](./SCHEMA.md). For the broader architectural rationale, see [AGENTS.md](./AGENTS.md).

---

## Why Sidecars

Three separations already implicit across the codebase, generalized:

- **`execution` outside the spec** ([SCHEMA.md § Execution Separate From Spec](./SCHEMA.md#execution-separate-from-spec)) — credentials and deployment never leak through a shared spec.
- **Pipecat hints as an export-time sidecar** ([TRANSLATIONS.md § Pipecat](./TRANSLATIONS.md#pipecat)) — vendor knobs (`context_strategy`, `respond_immediately`) keyed by flow id, not inside the flow.
- **Planned `annotations` namespace** ([MVP-PLAN.md § Schema decisions](./MVP-PLAN.md#schema-decisions)) — positions, colors, comments. Runtimes MUST ignore. Two export modes anticipated.

This document subsumes the third bullet and lifts the pattern to a general principle: **anything that is not behavior is a sidecar**. The spec stays minimal and portable; sidecars carry the rest.

The principle "Schema defines behavior. UI defines rendering." ([AGENTS.md § Design Principles](./AGENTS.md#design-principles)) is the long form. Sidecars are how that principle materializes in the document shape.

### What this is not

Sidecars are not a generic extensibility hatch. Two and only two are defined: `ui` and `tests`. Adding a third requires the same level of justification as adding a top-level field to the spec — a coherent consumer with a stable contract.

---

## Document Shape

A spec document with sidecars is a single JSON file with four optional top-level keys:

```json
{
  "agent": { "$schema": "UX4://agent/v0", ... },
  "flows": [ { "$schema": "UX4://flow/v0", ... } ],
  "ui":    { "$schema": "UX4://ui/v0", ... },
  "tests": { "$schema": "UX4://tests/v0", ... }
}
```

- `agent` and `flows` are the behavioral spec — same shape defined in [SCHEMA.md](./SCHEMA.md).
- `ui` and `tests` are sidecars — each governed by its own `$schema` discriminator.
- All four keys are independently optional. A spec without sidecars is the runtime artifact. A `ui`-only document with no `agent`/`flows` is not valid — sidecars reference the spec by stable id and cannot stand alone.

### Why one file, not three

Round-trip atomicity. The editor's autosave, import, export, and share flows operate on a single artifact. Splitting into `spec.json` / `spec.ui.json` / `spec.tests.json` would force every consumer to track three files and reconcile them — load order, partial loads, missing-companion handling all become surface area. One file with discriminated keys keeps that surface zero.

The single counter-argument — that runtime consumers shouldn't have to download `ui`/`tests` they'll discard anyway — is resolved by the export modes below.

---

## Export Modes

Two export modes; both produce a single JSON document.

| Mode | Emits | Used by |
|---|---|---|
| **`exportSpec`** | `{ agent, flows }` only. Sidecars stripped. | Runtime targets ([`../uxflows-runner/`](../uxflows-runner/), Pipecat / LangGraph / etc. codegen), client-facing artifacts, anywhere behavior is the only relevant contract. |
| **`exportAll`** | `{ agent, flows, ui?, tests? }`. Sidecars preserved if present. | Authoring round-trip (save, share with a collaborator, version-control archive). |

The editor's "Export" UI offers both as separate actions; `exportSpec` is the default for sharing externally, `exportAll` for save/backup/collaborate.

Importers accept either shape. Loading a sidecar-bearing document hydrates UI and test state; loading a spec-only document leaves those stores empty and the canvas falls back to deterministic layout (currently dagre).

### Round-trip semantics

- `exportAll → import` is lossless. Positions, comments, tests survive.
- `exportSpec → import` drops sidecars by design. Re-importing the runtime artifact rebuilds layout from the graph and starts comments / tests empty. This is correct behavior, not loss — runtime artifacts are not authoring artifacts.

Codegen targets (system prompt, Pipecat, LangGraph) always read as if sidecars were absent. They MUST NOT inspect `ui` or `tests`. The translation tables in [TRANSLATIONS.md](./TRANSLATIONS.md) cover only the behavioral spec.

---

## UI Sidecar

Authoring metadata that lives in the editor: where nodes sit on the canvas, what color they are, threaded comments anchored to flows or exit paths, and the configuration of the low-fi client-share view.

### Shape

```json
{
  "$schema": "UX4://ui/v0",
  "positions": {
    "<flow_id>": { "x": 0, "y": 0 }
  },
  "colors": {
    "flows":      { "<flow_id>":      "#hex" },
    "exit_paths": { "<exit_path_id>": "#hex" }
  },
  "comments": [
    {
      "id": "string",
      "anchor": { "kind": "flow | exit_path", "id": "string" },
      "resolved": false,
      "messages": [
        {
          "id": "string",
          "author": "string",
          "body": "string",
          "created_at": "ISO-8601"
        }
      ]
    }
  ],
  "share_view": {
    "enabled": false,
    "expose": {
      "flow_names":    true,
      "instructions":  false,
      "scripts":       "basic | full | none",
      "guardrails":    false,
      "capabilities":  false,
      "knowledge":     false
    }
  }
}
```

### Field notes

- **`positions`** — keyed by `flow.id`. Today the canvas re-runs dagre on every mutation; with `positions` present, dagre seeds from saved coords and a "Reset layout" action discards them. Required for round-trip layout stability.
- **`colors`** — author overrides to the type-derived default color. Optional, sparse.
- **`comments`** — threaded discussions anchored to a flow or exit path. Each thread has an array of messages, append-only by convention. Anchoring by stable id (not position) ensures comments survive layout changes and node reordering.
- **`comments[].messages[].author`** — free-text display name in stage-1 (single-user, no auth). Replaced by a stable user identifier when multi-user lands. Stage-2 migration is additive — existing string authors are preserved as `legacy_name`.
- **`share_view`** — configures the low-fi read-only render mode requested in conversation with Nirja (2026-05-19). The viewer sees the canvas only; sidebar/inspector/simulate are hidden. `expose` controls what fields render per node. Default off — opting in is per-spec.

### Identity in stage-1

Comments work locally without auth: the author field is a string the user types. This is enough for the export-and-share workflow (Nirja exports `exportAll`, emails to Aditya, Aditya opens locally, comments, exports back). It is **not** enough for concurrent multi-user — that requires the auth/server inversion deferred in [MVP-PLAN.md § Versioning of specs](./MVP-PLAN.md#beyond-mvp-deferred-with-reasons). The schema is designed so the inversion is additive: the stage-1 string author becomes a fallback alongside stage-2 stable user ids.

### Relationship to the inline `notes` field

The behavioral spec keeps the short `notes` field on flows and exit paths ([SCHEMA.md § Notes](./SCHEMA.md#notes-authoring-annotations)). Notes are terse, single-author, always-attached authoring annotation — "legal required this branch," "stakeholder asked for this." They are part of the spec and travel with `exportSpec`.

Comment threads are different: multi-author, longer-form discussion, resolvable, and they live in the UI sidecar. They are stripped by `exportSpec`.

The two coexist. A reviewer leaves a comment thread asking why a branch exists; the author resolves the discussion and condenses the conclusion into the flow's `notes`. The note survives runtime export; the discussion does not.

---

## Testing Sidecar

Test cases, response-style variants, run history, coverage state, and human-calibration annotations. Consumed by the eval harness (a mode of [`../uxflows-runner/`](../uxflows-runner/) — concurrent isolated sessions, simulated user driving each case k times) and by the editor's conversation-review surface (transcript viewing + grader calibration).

The shape reflects practice across conversational-agent evaluation: multidimensional graders, multiple trials per case (LLM behavior is non-deterministic), reference solutions to self-test the graders, balanced trigger / anti-trigger sets, and a clear case-source provenance so production conversations can be promoted into the suite.

### Shape

```json
{
  "$schema": "UX4://tests/v0",
  "cases": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "entry_flow_id": "string",
      "scenario": "string",

      "simulated_user": {
        "persona": "string",
        "response_style_ids": ["plain"],
        "max_turns": 20,
        "model_recommendation": "string (optional)"
      },

      "graders": [
        {
          "id": "string",
          "kind": "state_check",
          "expect_variables": { "variable_name": "any" },
          "expect_terminal_flow_id": "string (optional)"
        },
        {
          "id": "string",
          "kind": "path_check",
          "required_flow_ids":  ["string"],
          "forbidden_flow_ids": ["string"],
          "required_exit_path_ids":  ["string"],
          "forbidden_exit_path_ids": ["string"]
        },
        {
          "id": "string",
          "kind": "tool_call_check",
          "required":  [{ "capability_name": "string", "args_match": { "...": "..." } }],
          "forbidden": [{ "capability_name": "string" }]
        },
        {
          "id": "string",
          "kind": "llm_rubric",
          "rubric": "string",
          "assertions": ["string"],
          "model_recommendation": "string (optional)"
        },
        {
          "id": "string",
          "kind": "transcript_constraint",
          "max_turns": 10,
          "max_total_tokens": 4000
        }
      ],

      "reference": {
        "transcript": [
          { "role": "agent | user", "text": "string", "flow_id": "string (optional)" }
        ],
        "expected_traversed_flow_ids":      ["string"],
        "expected_traversed_exit_path_ids": ["string"]
      },

      "trial_count": 5,
      "polarity": "trigger | anti_trigger",
      "purpose":  "capability | regression",
      "source":   "authored | promoted_from_run | discovered_unhandled",

      "aggregates": {
        "trials_run":   5,
        "pass_at_1":    0.6,
        "pass_at_k":    0.92,
        "pass_caret_k": 0.31,
        "last_run_at":  "ISO-8601"
      }
    }
  ],

  "response_styles": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "instruction_fragment": "string"
    }
  ],

  "runs": [
    {
      "id": "string",
      "case_id": "string",
      "trial_index": 0,
      "release_id": "string (optional)",
      "started_at": "ISO-8601",
      "ended_at": "ISO-8601",

      "transcript": [
        { "role": "agent | user", "text": "string", "flow_id": "string (optional)", "ts": "ISO-8601" }
      ],
      "traversed_flow_ids":      ["string"],
      "traversed_exit_path_ids": ["string"],
      "final_variables":         { "variable_name": "any" },
      "capability_invocations":  [
        { "capability_name": "string", "args": { "...": "..." }, "result": "any | null", "error": "string | null" }
      ],

      "grader_results": [
        {
          "grader_id": "string",
          "passed": true,
          "score":  1.0,
          "detail": "string",
          "violations": [
            { "kind": "string", "ref_id": "string (optional)", "detail": "string" }
          ]
        }
      ],
      "result": "pass | fail | error | partial",

      "annotations": [
        {
          "id": "string",
          "author": "string",
          "verdict": "pass | fail | unclear",
          "notes": "string",
          "grader_overrides": [
            { "grader_id": "string", "human_verdict": "pass | fail" }
          ],
          "created_at": "ISO-8601"
        }
      ]
    }
  ],

  "coverage": {
    "flows":      { "<flow_id>":      { "last_run_id": "string", "status": "pass | fail | unrun" } },
    "exit_paths": { "<exit_path_id>": { "last_run_id": "string", "status": "pass | fail | unrun" } }
  }
}
```

### Field notes

#### Cases

- **`simulated_user`** — first-class object, not free text plus tag references. The eval harness uses this directly: `persona` becomes the simulated user's system prompt; `response_style_ids` reference entries in `response_styles` to layer canned variants (plain agreement, blabbering, conflicting, gray-area — taxonomy surfaced 2026-05-19); `max_turns` bounds the conversation so a stuck case doesn't run forever; optional `model_recommendation` pins the simulator's model for reproducibility. The pattern matches τ-Bench / τ2-Bench, where one model plays the user persona while the agent navigates the scenario.
- **`graders`** — structured array, not flat string lists. Multiple kinds per case is the norm: a refund case typically wants state_check (refund processed) + tool_call_check (`process_refund` fired with bounded args) + llm_rubric (tone, empathy, explanation) + transcript_constraint (≤ 10 turns). Each grader passes or fails independently — partial credit is intrinsic.
  - **`state_check`** — final variable bag must contain expected values; optional terminal-flow assertion. Cheap and deterministic; the post-conversation `outcome` rather than just the transcript.
  - **`path_check`** — required / forbidden flow ids and exit path ids. UX4's traversed-path data ([`runs[].traversed_flow_ids`](#)) makes this exact, not heuristic. Avoid over-specifying — grade what the agent produced, not the path it took, unless path is the behavior under test.
  - **`tool_call_check`** — required and forbidden capability invocations, with optional argument matching. Catches "did the agent actually verify policy" beyond what the transcript shows.
  - **`llm_rubric`** — natural-language assertions scored by an LLM judge. Always give the judge a way out ("return `unclear` if you don't have enough information"). Calibrate against human verdicts via `runs[].annotations[].grader_overrides`.
  - **`transcript_constraint`** — bounded-resource checks: turn count, token count. Production-feel proxies.
- **`reference`** — known-good transcript and expected traversed path. Self-tests the graders: if the reference doesn't pass every grader, the graders are broken, not the agent. Catches the class of bugs Anthropic documented in CORE-Bench (Opus 4.5 scored 42% → 95% after grader fixes) and METR (instructions penalized models that followed them). Optional but strongly recommended.
- **`trial_count`** — k trials per case. LLM outputs vary between runs; one trial is not a signal. Default 5 for capability cases, 3 for regression. Aggregates land in `case.aggregates`.
- **`polarity`** — `trigger` cases assert the behavior *should* happen; `anti_trigger` cases assert it *should not*. Balanced sets matter: an agent evaluated only on "did it search when it should" learns to search for everything. Authoring guideline: pair every trigger case with at least one anti-trigger case in the same suite.
- **`purpose`** — `capability` cases start at low pass rates and provide hill-climbing signal. `regression` cases sit near 100% and catch backsliding. A capability case graduates to a regression case once it passes reliably; the editor surfaces this as a one-click promotion.
- **`source`** — provenance. `authored` is hand-written. `promoted_from_run` is a case lifted from a real run (sim or production) and locked. `discovered_unhandled` is the dog-ate-my-shoes class: a production conversation the agent failed to handle predictably, captured to drive future capability work. The third value is what the production-feedback loop attaches to.
- **`aggregates`** — derived from `runs[]` filtered by `case_id`. `pass_at_1` is the per-trial success rate (mean over trials). `pass_at_k` is the probability at least one of k trials passes (`1 - (1-p1)^k`). `pass_caret_k` is the probability all k trials pass (`p1^k`). Use `pass_at_1` for hill-climbing, `pass_caret_k` for the "is this reliable enough to ship" gate. Recompute lazily or on every run — same trade-off as `coverage`.

#### Response styles

- **`response_styles`** — library of named user-response variants. Authors define once, reference from many cases. Each entry's `instruction_fragment` appends to the simulated-user prompt at trial time.

#### Runs

- **`runs`** — append-only run history, one entry per trial (so a case with `trial_count: 5` produces five runs). Each entry captures the full transcript, the path traversed, the final variable state, the capabilities invoked, and the per-grader verdicts. The traversed-path data powers canvas overlay and is the foundation for fork-from-turn replay. Replaying a saved run against a live runner session needs per-turn snapshots on the runner — see [`../uxflows-runner/RUNNER-PLAN.md`](../uxflows-runner/RUNNER-PLAN.md) § Open questions.
- **`runs[].trial_index`** — 0-based index within the case's k trials. Same `(case_id, trial_index)` pair across re-runs overwrites; bumping `case.trial_count` upward extends.
- **`runs[].release_id`** — optional pin to the immutable release artifact the run executed against (spec + execution config + model version + content hash). When release artifacts ship, every run records which release it tested. Until then, omit.
- **`runs[].grader_results`** — per-grader pass/fail/score with violation detail. The case-level `result` is rolled up from these: `pass` iff every grader passed; `partial` if some did; `fail` otherwise; `error` for harness failures (env timeout, runner crash) that aren't an agent verdict.
- **`runs[].annotations`** — human review of a run. Captures the human verdict alongside grader verdicts; `grader_overrides` lets a reviewer say "the llm_rubric scored this as pass but it actually failed" — the divergence is the calibration signal. Author identity is the same stage-1 free-text string as the UI sidecar's comments (see [Identity in stage-1](#identity-in-stage-1)); becomes stable user ids when auth lands.

#### Coverage

- **`coverage`** — derived state, materialized for fast canvas overlay. Keyed by flow id and exit path id, holds `last_run_id` and rollup status. Re-derivable from `runs` if dropped or invalidated.

### Eval harness

A mode of [`../uxflows-runner/`](../uxflows-runner/) (not a separate repo until the surface naturally separates). Takes a spec + a `tests.cases[]` slice + an execution config, spawns isolated runner sessions concurrently, drives each with a simulated-user LLM following the case's `simulated_user.persona` + response styles, populates `runs[]`. Trial isolation is non-negotiable — shared state between trials (cached capability results, leftover variable bags) creates correlated failures that look like agent regressions.

The harness reuses the same dispatcher as voice / text modes; the simulated user is just a different driver of the text-mode `/api/chat/turn` loop. `mock_returns` ([`RUNNER-PLAN.md § Capability mocks`](../uxflows-runner/RUNNER-PLAN.md)) provides the per-session capability fixtures so cases can run without external services.

### Auto-regeneration of cases on spec change

When a flow changes, cases that traverse it become stale. The editor surfaces this on affected cases (aggregates clear, status reverts to `unrun`); a "regenerate" action re-runs the case against the updated spec. Two heuristics:

- A change to a flow's `instructions`, `scripts`, or guardrails invalidates every case whose `traversed_flow_ids` includes the flow.
- A change to an `exit_path`'s `condition` or `goto` invalidates every case whose `traversed_exit_path_ids` includes the exit path.

Reference solutions (when present) also re-run as a self-test pass: if the reference no longer satisfies all graders after a spec change, the spec change broke a contract the test was protecting.

### Why a sidecar and not the spec

Test cases reference spec entities by id but do not define behavior. A spec without tests is fully meaningful at runtime. A test suite without a spec is meaningless. The dependency direction is one-way — tests depend on spec, spec does not depend on tests — so the sidecar relationship matches the actual semantics.

Putting tests in the spec would also force schema bumps on the sibling repos every time the testing model evolves. The sidecar isolates that evolution to the editor, the runner's harness mode, and `../whatsupp2/`.

---

## Migration

The sidecar shape is additive. Existing specs continue to load and round-trip — the new keys are simply absent.

- **Inline `notes` field**: stays. See [Relationship to the inline `notes` field](#relationship-to-the-inline-notes-field) above.
- **Canvas positions today**: live in component state and are not persisted across reload (dagre re-layout runs on every load). Once `ui.positions` lands, the canvas seeds from it; existing specs continue to use dagre.
- **Today's Simulate transcripts**: ephemeral, in-memory only. The first testing-sidecar work persists them into `tests.runs`.

No data migration is required for existing specs in the wild. The first time a user takes an action that produces sidecar data (drags a node, leaves a comment, runs a test), the corresponding sidecar key materializes.

---

## What This Changes Elsewhere

This document supersedes scattered references in the other docs. When this lands:

- **[SCHEMA.md § Spec Document](./SCHEMA.md#spec-document)** — note that the document may also carry optional `ui` and `tests` keys governed by their own schemas; defer to this file.
- **[AGENTS.md § Authoring surfaces](./AGENTS.md#authoring-surfaces)** — split today's single "Export as JSON" into `exportSpec` and `exportAll`. The low-fi share view is added as a new surface.
- **[TRANSLATIONS.md](./TRANSLATIONS.md)** — clarify that all translation targets read `exportSpec` output; sidecars are never inputs to codegen.
- **[MVP-PLAN.md § Schema decisions](./MVP-PLAN.md#schema-decisions)** — the planned `annotations` namespace is realized as the `ui` sidecar in this document; replace with a pointer here. Testing-sidecar items (`tests.cases`, `tests.runs`, coverage overlay on canvas) join the post-MVP roadmap and depend on this document, not on a SCHEMA bump.

---

## Open Questions

- **Multi-author identity in stage-1 comments and annotations.** The `author` string is enough for export-and-email collaboration but offers no spoofing protection. Acceptable for the same-team use case; not for client-facing review. The stage-2 inversion (auth + server) makes this rigorous; until then, comments and annotations are advisory.
- **What counts as a "structural change" for case regeneration.** The two heuristics in [Auto-regeneration of cases on spec change](#auto-regeneration-of-cases-on-spec-change) cover the common cases; edge cases (renaming a variable referenced only in instructions, adding a guardrail that doesn't fire) need real authoring use before being specified.
- **Coverage derivation cadence.** Recompute on every run vs. lazily on canvas open. Lazy is cheaper but inconsistent across tabs. Pick when canvas overlay ships.
- **Share-view granularity.** Today's `share_view.expose` is per-field across the whole spec. If clients want per-flow exposure (some flows visible, others hidden), the structure generalizes; defer until a client actually asks.
- **Aggregate recomputation cadence.** Same trade-off as `coverage` — recompute `case.aggregates` on every run vs. lazily on case open. Probably the same answer, picked at the same time.
- **Reference-solution authoring workflow.** A reference is a known-good run, not a hand-written transcript. Cheapest authoring path is "designer runs the case via Simulate, marks the run as the reference, optionally edits the transcript." Needs UI work in the editor; not a sidecar shape question.
- **`release_id` provenance.** `runs[].release_id` references the immutable release artifact (spec + execution config + model version + content hash). The release artifact doesn't exist yet — when it ships, every run records which release it tested. Until then, omit the field. Lives in this doc as a hook rather than a question because the dependency is on a piece outside the sidecar.
