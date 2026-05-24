# Making the evaluation surface load-bearing

Three open threads share one underlying problem: a test run produces results,
but those results aren't yet rich enough, structured enough, or expressive
enough to drive iteration on their own. Today they're a print-stream that a
human reads case-by-case. To get from "we have tests" to "tests *tell us
what to change*," the result side of the loop needs three upgrades that
together form one feature surface.

Reading order: [MVP-PLAN.md](./MVP-PLAN.md) Phase 2 for product context,
[docs/optimization-loop.md](./docs/optimization-loop.md) for the
autonomous-iteration endgame this unblocks,
[docs/runner-testing.md](./docs/runner-testing.md) for the harness this
extends.

---

## The three threads

### 1. Run-level manifest + inter-run comparison

Per-case results land in `tests/runs/<ts>-<label>/<case_id>.json` today, but
there's no run-level manifest and no built-in way to diff two runs. The
question "which cases improved or regressed between yesterday and today?"
requires hand-rolled jq.

What's missing: a `manifest.json` at the run root summarizing pass/fail counts
per case, suite-level pass rate, model/prompt versions used, and the inputs
that defined the run (spec hash, test-case set, evaluator set). And a thin
comparison view — given two run directories, render a per-case diff: status
flipped, score delta, transcript divergence point.

The schema lives next to the result schema in `@ux4/core/src/schema/files/`
(see MVP-PLAN.md §"Result schema"). The `UX4://result/v0` posture is
additive-by-default, so the manifest can ride alongside per-case results
without disturbing the producer/consumer contract.

Size: ~1 day. Mostly JSON-shape definition and a Python or TypeScript
aggregation pass.

### 2. `final_variables` assertions exercised end-to-end

The runner already binds capability outputs into variable scope on exit-path
actions (FNOL validates this — `verify_policy → policy_active`,
`file_claim → claim_id`). The result schema reserves `final_variables{}` as
a well-known optional field. What's missing is the test-harness side:
a `state_check` evaluator that asserts a variable holds a specific value
(or matches a pattern, or is non-empty) at the end of a run, and at least
one test suite (Tala is the obvious candidate) exercising the pattern
systematically.

This is the load-bearing mechanic for capability-bound flows. Without it,
"the right capability got called with the right args" is testable but
"the right value ended up bound to the right variable name" is not.

Size: ~half day. Mostly evaluator wiring + a handful of test cases.

### 3. Rubrics wired into the runner (LLM-judge evaluator)

The rubric schema (`UX4://rubric/v0`) is defined. The runner doesn't yet
load it, and there's no LLM-judge evaluator that consumes it. Substring
assertions cover the easy cases ("did the agent say X?") but hit a ceiling
on semantic criteria like "acknowledged the customer's hardship before
offering an alternative" — pass/fail there requires a judge model reading
the whole transcript against rubric criteria and returning a structured
verdict.

The result schema already reserves `evaluator_results[]` with `name`,
`passed`/`score`, and free-form `notes`, and a `judge_model` field so the
judge is itself reproducible. The work is: rubric loader, judge prompt
template, per-criterion LLM call (Gemini JSON mode is the natural fit here
— same pattern as the contextVars/capabilityMocks generators), and result
emission.

Per [docs/optimization-loop.md](./docs/optimization-loop.md), this is the gating
dependency for any autonomous optimizer. Without semantic evaluators the
loop can't read its own report card.

Size: ~3-5 days. Largest of the three.

---

## Why they're one initiative

Each one alone is a partial answer. Together they convert test runs into a
substrate iteration can stand on:

- The **manifest** makes a run a single addressable artifact you can point
  at and compare.
- **`final_variables` assertions** extend "what did the agent say?" to
  "what state did the agent leave the world in?" — closing the loop on
  capability-bound flows.
- **Rubric-driven judge evaluators** push past lexical assertions into the
  semantic criteria that actually matter for real conversations.

They share a result-schema surface (`evaluator_results[]`,
`final_variables{}`, the per-run manifest) and a single architectural
choice: the producer/consumer contract is additive, so new evaluator types
and new aggregation fields ride along without forking the schema.

Suggested order if tackling all three: **(2) `final_variables` first**
(smallest, unblocks Tala validation), **(1) manifest second** (high leverage
on iteration velocity once you have runs to compare), **(3) rubric judge
last** (largest, and benefits from having (2) and (1) already producing
structured comparison data to judge against).
