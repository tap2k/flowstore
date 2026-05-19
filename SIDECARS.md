# Sidecars

UX4 separates **behavior** (the spec — agent + flows) from **authoring metadata** (UI state, comments, tests, run history) by colocating both in the same document under distinct top-level keys, each governed by its own `$schema`. Runtimes consume only the behavioral keys; the rest is annotation that rides along for authoring round-trip and is stripped on runtime export.

This document defines the two sidecars: **`ui`** (positions, colors, comment threads, share-view config) and **`tests`** (test cases, response-style variants, run history, coverage). It also defines the two export modes — **`exportSpec`** (runtime: behavior only) and **`exportAll`** (authoring: everything).

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

Test cases, response-style variants, run history, and coverage state. Consumed by the editor's stress-test panel and (eventually) by `../whatsupp2/` as evaluation input.

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
      "persona": "string",
      "response_style_ids": ["plain"],
      "should_happen":     ["string"],
      "should_not_happen": ["string"],
      "expected_terminal_flow_id": "string (optional)",
      "last_run_id": "string (optional)",
      "last_status": "pass | fail | unrun"
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
      "started_at": "ISO-8601",
      "ended_at": "ISO-8601",
      "transcript": [
        { "role": "agent | user", "text": "string", "flow_id": "string (optional)" }
      ],
      "traversed_flow_ids": ["string"],
      "traversed_exit_path_ids": ["string"],
      "result": "pass | fail | error",
      "violations": [
        { "kind": "should_happen_missed | should_not_happen_fired | guardrail", "ref_id": "string", "detail": "string" }
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

- **`cases`** — first-class test case objects, each anchored to an `entry_flow_id`. The `scenario` is free text describing the situation; `persona` is the user profile; `response_style_ids` references entries in `response_styles` to layer canned variants (plain-yes, blabbering, conflicting, gray-area) on top of the persona without rewriting it each time. `should_happen` / `should_not_happen` are evaluation assertions checked against the transcript.
- **`response_styles`** — library of named user-response variants. Authors define once, reference from many test cases. Captures the taxonomy surfaced in conversation with Nirja (2026-05-19): plain agreement, blabbering, conflicting answers, gray-area nuance.
- **`runs`** — append-only run history. Each entry captures the full transcript and the path traversed (both flow ids and exit path ids in order). The traversed-path data is what powers end-of-run path visualization on the canvas and is the foundation for fork-from-turn replay. Replaying a saved run against a live runner session needs per-turn snapshots on the runner — see [`../uxflows-runner/RUNNER-PLAN.md`](../uxflows-runner/RUNNER-PLAN.md) § Open questions.
- **`coverage`** — derived state, materialized for fast canvas overlay. Keyed by flow id and exit path id, holds `last_run_id` and rollup status. Re-derivable from `runs` if dropped or invalidated.
- **Auto-regeneration of test transcripts.** When a flow changes, the test cases that traverse it become stale. The editor surfaces this on the affected cases (status reverts to `unrun`); a "regenerate" action runs the case against the updated spec and refreshes the transcript. The trigger is structural change to a referenced flow's behavior — what counts as "structural" is the open authoring decision.

### Why a sidecar and not the spec

Test cases reference spec entities by id but do not define behavior. A spec without tests is fully meaningful at runtime. A test suite without a spec is meaningless. The dependency direction is one-way — tests depend on spec, spec does not depend on tests — so the sidecar relationship matches the actual semantics.

Putting tests in the spec would also force schema bumps on the sibling repos every time the testing model evolves. The sidecar isolates that evolution to the editor and `../whatsupp2/`.

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

- **Multi-author identity in stage-1 comments.** The `author` string is enough for export-and-email collaboration but offers no spoofing protection. Acceptable for the same-team use case; not for client-facing review. The stage-2 inversion (auth + server) makes this rigorous; until then, comments are advisory.
- **What counts as a "structural change" for test regeneration.** Adding a new exit path almost certainly invalidates tests that traversed the affected flow; rewording an instruction probably doesn't. Heuristics need real authoring use before being specified — defer until the test-case feature is live and accumulating examples.
- **Coverage derivation cadence.** Recompute on every run vs. lazily on canvas open. Lazy is cheaper but inconsistent across tabs. Pick when canvas overlay ships.
- **Share-view granularity.** Today's `share_view.expose` is per-field across the whole spec. If clients want per-flow exposure (some flows visible, others hidden), the structure generalizes; defer until a client actually asks.
