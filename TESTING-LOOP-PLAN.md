# Making the testing loop usable end-to-end

The Phase 2 testing surface is on disk in pieces: test cases, personas, mocks, rubrics, and result files have schemas; the runner produces results; the SimulatePanel runs simulations; Python scripts execute regressions. What's missing is the *loop* — the designer-facing path that goes **author a test case → run it → see a rich result → diff against prior runs → capture a good exploration as a new test case**, all without bouncing between the editor and a terminal.

This plan groups the work into the three parts of that loop. None of the items are large individually; the win is treating them as one push rather than six unrelated tickets.

Reading order: [MVP-PLAN.md](./MVP-PLAN.md) Phase 2 §B/D/G for the product context this consolidates; [docs/test-driven-prompts.md](./docs/test-driven-prompts.md) for the methodology this enables; [docs/optimization-loop.md](./docs/optimization-loop.md) for the autonomous-iteration endgame this unblocks; [docs/runner-testing.md](./docs/runner-testing.md) for the harness mechanics. Where this plan mentions a "result file" it refers to the `flowstore://result/v0` schema described in [MVP-PLAN.md §A](./MVP-PLAN.md#a-file-types--loader).

---

## Input side: load and capture test cases (editor)

Test cases are JSON files in `tests/cases/*.test.json` today. Designers author them by hand or by capture; the editor doesn't yet help with either path. Two small features close that gap.

### I-1. Test-case dropdown in SimulatePanel

A dropdown in [SimulatePanel.tsx](packages/browser/components/runtime/SimulatePanel.tsx) that lists every `tests/cases/*.test.json` in the loaded project. Picking one populates the `user_turns` for the simulate run (and any case-level `vars_file` / `mock_returns` / `persona` references). Pairs with the existing variables / mocks / persona forms — those stay live but read defaults from the selected case.

The selection is *editor state*, not spec state — picking a case for exploration shouldn't dirty the spec. Lives in the existing zustand simulate store.

Size: ~half day. Mostly wiring an existing file-loader hook to a new `<select>` and pre-filling form state.

### I-2. Capture-as-test-case button

A button on a finished simulate transcript that writes `tests/cases/<auto-id>.test.json` with the extracted user turns, the active vars, the active mocks, and (optionally) the active persona reference. Auto-id from the first user turn's first ~40 chars, slugified, with a numeric suffix on collision — designer renames if they want.

The other end of the loop: explore freely, lock the good ones as regression. The browser already has the transcript and the form state; this is mostly a save-to-disk action with the right shape.

Size: ~half day.

---

## Execution side: nothing new in this plan

Execution already works — the runner runs, [`run.py`](examples/coffee-testing/scripts/run.py) drives regression sweeps, SimulatePanel runs single cases live. This section exists to make the input → output narrative complete; the work is in I-* (load + capture) and O-* (rich output + viewing). If a future test runner concern shows up (parallel execution, sharding, etc.), it belongs here.

---

## Output side: make results rich enough to drive iteration

Per-case results land in `tests/runs/<ts>-<label>/<case_id>.result.json` today, but they're a print-stream — a human reads case-by-case. To get from "we have tests" to "tests *tell us what to change*," the result side needs three upgrades that share one result-schema surface.

### O-1. `final_variables` assertions exercised end-to-end (Python)

The runner already binds capability outputs into variable scope on exit-path actions (FNOL validates this — `verify_policy → policy_active`, `file_claim → claim_id`). The result schema reserves `final_variables{}` as a well-known optional field. What's missing is the test-harness side: a `state_check` evaluator that asserts a variable holds a specific value (or matches a pattern, or is non-empty) at the end of a run, and at least one test suite (Tala is the obvious candidate) exercising the pattern systematically.

This is the load-bearing mechanic for capability-bound flows. Without it, "the right capability got called with the right args" is testable but "the right value ended up bound to the right variable name" is not.

Size: ~half day. Mostly evaluator wiring + a handful of test cases.

### O-2. Run-level manifest + inter-run comparison (Python)

Per-case results exist; there's no run-level manifest and no built-in way to diff two runs. The question "which cases improved or regressed between yesterday and today?" requires hand-rolled jq.

What's missing: a `manifest.json` at the run root summarizing pass/fail counts per case, suite-level pass rate, model/prompt versions used, and the inputs that defined the run (spec hash, test-case set, evaluator set). And a thin comparison view — given two run directories, render a per-case diff: status flipped, score delta, transcript divergence point.

The schema lives next to the result schema in `@flowstore/core/src/schema/files/`. The `flowstore://result/v0` posture is additive-by-default, so the manifest can ride alongside per-case results without disturbing the producer/consumer contract.

Size: ~1 day. Mostly JSON-shape definition and a Python or TypeScript aggregation pass.

### O-3. Result file viewer in SimulatePanel (editor)

A SimulatePanel mode that loads a `tests/runs/<ts>/<case>.result.json` and renders it in the same transcript-display surface as a live simulate run. Shows: the transcript, the per-evaluator pass/fail, `final_variables`, `capability_calls`, model/prompt metadata. Read-only.

Pairs with O-2's manifest: in a follow-up, the viewer can render a *run* (the manifest + all its cases) and let a designer click into a single case. Without the manifest the viewer is one case at a time with no aggregate context, which is why this lands after O-2 — but the per-case shape works standalone if a designer wants to review a specific result.

Size: ~1 day.

### O-4. Rubrics wired into the runner (Python)

The rubric schema (`flowstore://rubric/v0`) is defined. The runner doesn't yet load it, and there's no LLM-judge evaluator that consumes it. Substring assertions cover the easy cases ("did the agent say X?") but hit a ceiling on semantic criteria like "acknowledged the customer's hardship before offering an alternative" — pass/fail there requires a judge model reading the whole transcript against rubric criteria and returning a structured verdict.

The result schema already reserves `evaluator_results[]` with `name`, `passed`/`score`, and free-form `notes`, and a `judge_model` field so the judge is itself reproducible. The work is: rubric loader, judge prompt template, per-criterion LLM call (Gemini JSON mode is the natural fit here — same pattern as the contextVars/capabilityMocks generators), and result emission.

Per [docs/optimization-loop.md](./docs/optimization-loop.md), this is the gating dependency for any autonomous optimizer. Without semantic evaluators the loop can't read its own report card.

Size: ~3-5 days. Largest item in the plan.

---

## Why this is one initiative

The pieces share two surfaces:

1. **The result-schema surface** (`evaluator_results[]`, `final_variables{}`, the per-run manifest). The producer/consumer contract is additive-by-default, so new evaluator types and new aggregation fields ride along without forking the schema.
2. **The SimulatePanel surface.** Input-side dropdowns (I-1), capture (I-2), and result viewer (O-3) all extend the same component and share its zustand store.

Splitting input from output by language (browser vs Python) fragments the designer-facing workflow. The designer doesn't think "Phase 2 §B item iv;" they think "I want to write a test case, run it, see if it passed, and lock it down." One plan, six items, ordered for incremental landing:

| Order | Item | Where | Size | Unblocks |
|---|---|---|---|---|
| 1 | **O-1** `final_variables` assertions | Python | ~½ day | Tala validation; exercises an existing runner mechanic |
| 2 | **I-1** Test-case dropdown | Editor | ~½ day | Designer uses authored cases without leaving the editor |
| 3 | **I-2** Capture-as-test-case | Editor | ~½ day | Closes the explore → lock loop |
| 4 | **O-2** Run manifest + diff | Python | ~1 day | Iteration velocity; comparison across runs |
| 5 | **O-3** Result viewer | Editor | ~1 day | Designers review CI runs inline; depends on O-2 for aggregate context |
| 6 | **O-4** Rubric judge | Python | ~3-5 days | Autonomous optimization; semantic criteria |

Items 1-4 are roughly ~3 days end-to-end and land the loop's core. Items 5-6 are follow-ups that benefit from the earlier ones already producing structured artifacts to view and judge against.
