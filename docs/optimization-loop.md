# The flowstore optimization loop

A description of the end-to-end loop flowstore enables today, what makes it candidate
for self-optimization, and the concrete gaps an autonomous optimizer would hit
right now. Reading order: [MVP-PLAN.md](../MVP-PLAN.md) for the product context,
[testing-from-scripts.md](testing-from-scripts.md) for the harness mechanics,
[test-driven-prompts.md](test-driven-prompts.md) for the methodology this
extends.

---

## The loop, in one diagram

```
  ┌─────────────────────────┐
  │ Client source materials │
  │  - docs / Figma         │
  │  - script spreadsheets  │
  │  - gold-standard tests  │
  │  - call recordings      │
  │  - legacy system prompt │ ← optional input AND/OR comparison baseline
  └────────┬────────────────┘
           │
           │  AGENT-SPEC-PROMPT (LLM, one-shot, schema-constrained)
           │  GOLD-EXTRACTION-PROMPT (LLM)
           ▼
  ┌─────────────────────────┐         ┌────────────────────┐
  │  flowstore project (Git repo) │         │  Legacy prompt     │
  │   spec (decomposed)     │         │  (txt, optional)   │
  │   tests/gold/*          │         └─────────┬──────────┘
  │   tests/cases/*         │                   │
  │   tests/vars.*.json     │                   │
  │   capabilities/*.mock   │                   │
  └────────┬────────────────┘                   │
           │                                    │
           │  flowstore-compile                       │
           │   --format prompt   ──► system_prompt + tool_schemas
           │   --format spec     ──► resolved {agent, flows} for runtimes
           ▼                                    │
  ┌──────────────────────────────────┐          │
  │  Targets under test              │          │
  │   • flowstore-compiled prompt          │          │
  │   • Legacy hand-authored prompt  │◄─────────┘
  │   • Runner / LangGraph / Pipecat │
  │     (graph-native, tool_schemas  │
  │      still come from the spec)   │
  └────────┬─────────────────────────┘
           │
           │  run.py × N trials per case
           │  (same cases, same mocks, same model — vary only the target)
           ▼
  ┌─────────────────────────────────┐
  │ tests/runs/<ts>-<label>/*.result│
  │   transcripts, tool calls,      │
  │   final_variables, eval results │
  └────────┬────────────────────────┘
           │
           │  Diff matrix per (case × target × assertion)
           ▼
  ┌─────────────────────────────────┐
  │ Decision                        │
  │  • Ship                         │
  │  • Edit spec / generator / vars │  ─── feedback edge into the spec
  │  • Tighten / weaken assertion   │
  │  • Different model              │
  └─────────────────────────────────┘
```

The contract that makes this work: **tool schemas always come from the spec**,
so apples-to-apples comparison across the three target types is enforced by
construction. Only the prose / graph wiring varies between targets. Same user
turns, same mocks, same model, same tool schemas — anything else would be
measuring two things at once.

---

## Why this shape is candidate for self-optimization

The classic argument against autonomous prompt optimization is that the
artifact under optimization (a 600-line system prompt blob) is unstructured —
any mutation has unpredictable blast radius, and there's no gradient. flowstore
restructures the problem:

1. **The spec is the source of truth, not the prompt.** Optimizers mutate
   structured surfaces with stable ids (per-flow `instructions`, `scripts`,
   `guardrails`, exit-path `condition` expressions) and re-compile. That's
   tractable in a way 600-line prose mutations are not.
2. **The diff matrix is a real gradient.** A change that flips a red cell green
   without regressing any other cell is unambiguously good. A change that flips
   one green and one red is a trade-off the loop surfaces explicitly.
3. **Comparison baselines are first-class.** The same harness that runs the
   flowstore-compiled prompt runs the legacy prompt under identical conditions. An
   optimizer always has a baseline to beat, not just an abstract quality target.
4. **The result file is the contract.** `flowstore://result/v0` carries transcripts,
   tool calls, final variables, and evaluator results in a stable shape — any
   optimizer reads the same thing the human reads.
5. **Run-dir naming is pivotable.** `tests/runs/<ts>-<label>/` lets paired runs
   (current vs proposed, flowstore vs legacy) sit next to each other on disk and be
   diffed mechanically.

The architectural bet is: **edit-spec-and-recompile** is a much smaller mutation
surface than **edit-prose-prompt**, and that's the difference between an
optimizer that converges and one that wanders.

---

## What's solid today

The contract is robust:

- File shapes pinned via `$schema` URIs (`flowstore://test-case/v0`,
  `flowstore://result/v0`, `flowstore://capability-mock/v0`, etc.); the editor and loader
  reject malformed files.
- Tool-schema-from-spec is enforced by `flowstore-compile --format prompt`; you
  can't accidentally A/B two prompts with different capability surfaces.
- Mock dispatch is keyed deterministically on `(capability_id, variant)`;
  unbound capabilities fail hard, not silently.
- The methodology (gold → case → run → diff → iterate) is validated on a real
  customer spec: in a recent validation, the flowstore-compiled prompt beat the
  hand-authored production prompt on 4 of 9 cases, lost 1, tied 5, all
  reproducible across 3 trials at temperature 0. The worked example at
  [`examples/coffee-testing/`](../examples/coffee-testing/) demonstrates the
  full harness shape.
- The same harness drives the runner / translator surfaces ([TRANSLATION-POC](../TRANSLATION-POC.md)
  validated dispatch fidelity for the LangGraph target on 6/6 live runs).

What is **not** robust enough for autonomous optimization without human review:

- **Substring assertions are a weak signal.** They legitimize paraphrase
  failures ("model said the right thing in different words") and reward literal
  mimicry. An optimizer that's only graded on substring matches will converge
  on prompts that maximize substring hits, which is not the goal.
- **No LLM-judge wiring yet.** `flowstore://rubric/v0` is specced; the runner doesn't
  evaluate them. Until it does, the assertion vocabulary can't express
  semantic criteria like "acknowledge the customer's hardship and offer an
  alternative" without smuggling the criterion into substring matches.
- **Multi-trial noise isn't categorized.** Pass@3 surfaces flakiness; nothing
  in the result file tells an optimizer whether 2/3 is "fix the prompt" or
  "structural model variance." Without that distinction, optimization chases
  noise.
- **Cross-case interference is invisible.** The matrix shows what regressed; it
  doesn't say *why*. A human reading transcripts catches "this generator
  tweak fixed wrong-number but the VERIFICATION-block regression is *caused
  by* the same change." The matrix doesn't.
- **Source-material → spec is one-shot.** AGENT-SPEC-PROMPT runs once at
  ingest. There's no edge back from test failures into a spec re-derivation
  step. An optimizer needs that back-edge to handle "tests reveal the spec is
  missing a broken-PTP branch — revise the spec, not just the prompt."

---

## What an autonomous optimizer would need

In rough order of value-per-effort:

1. **LLM-judge rubrics wired into the runner.** Schema slot exists; runner
   integration doesn't. Unlocks semantic assertions and removes the substring
   ceiling. Listed as an open problem in [test-driven-prompts.md](test-driven-prompts.md#open-problems).
2. **Aggregate matrix as an artifact, not stdout.** A `manifest.json` per
   run-dir with pass-rate, pass@N, and per-assertion structured results. Lets
   an optimizer compare runs without re-parsing stdout. Already on the
   [MVP-PLAN deferred list](../MVP-PLAN.md) under "Multi-trial aggregation".
3. **Mechanism categorization on red cells.** Today a red cell is just "no."
   Categories the doc names today (assertion / vars / spec content / generator
   / model) are diagnosed by a human. If the runner can mark "no substring
   match but rubric judge says acceptable paraphrase," the optimizer learns
   which red cells to ignore.
4. **Cross-case regression flagging.** Pair every run with its predecessor and
   surface (regressed, fixed, unchanged) per case. Cheap; just diff result
   files. The structure already supports it (pivot on `prompt_source` +
   `test_case_id`).
5. **Routing observability without scaffolding.** Today routing is inferred
   from transcript content, which only works when each flow has distinctive
   utterances. A synthetic `mark_flow_entered(flow_id)` capability, runner
   instrumentation, or LLM-judge routing inference would let an optimizer
   know which flow fired even on generic phrasings. Also in
   [test-driven-prompts.md open problems](test-driven-prompts.md#open-problems).
6. **Spec-mutation primitives.** Today an optimizer would edit `.flow.json` /
   `agent.json` files directly. That works but it's coarse. A typed mutation
   API ("tighten this exit's condition," "add a guardrail to this flow,"
   "split this script entry into a variation set") would constrain the search
   space to behaviorally-meaningful edits.
7. **A back-edge from tests to spec re-derivation.** The hardest. Today
   AGENT-SPEC-PROMPT runs once. To close the loop, the optimizer needs to be
   able to say "these failing cases imply the spec is missing structure X"
   and revise — not just tune the existing structure. Requires a way to
   represent test failures as input to the parser.

None of (1)-(5) are deep designs; they're unfilled slots in the existing
contract. (6) and (7) are research-shaped.

---

## When the legacy-prompt input matters

Three cases worth being explicit about:

1. **As a comparison baseline.** Standard migration check: is the flowstore-compiled
   prompt at least as good as what the customer is already running? Run the
   same cases against both, diff the matrix. This is what the Tala validation
   did.
2. **As a partial input to spec derivation.** If the customer's legacy prompt
   encodes routing decisions or guardrails the source docs don't, the parser
   should ingest the prompt alongside the docs. AGENT-SPEC-PROMPT accepts
   free-form source material; a system prompt is just more source material.
3. **As a wrapper kept around the compiled spec.** `agent.system_prompt_template`
   lets a designer keep the customer's persona framing or hard-rules preamble
   as a wrapper, with `{generated}` filled in by the deterministic codegen.
   The A/B becomes three-way: bare flowstore vs. wrapper × flowstore vs. fully
   hand-authored.

For optimization, (1) is the most load-bearing — it gives the optimizer a
non-trivial baseline to beat, which is more honest than measuring against an
abstract quality target.

---

## Honest assessment

The *contract* is robust enough to support autonomous optimization. The
*automation* layer is thin — `run.py` is ~150 lines, the matrix is stdout,
evaluators are stubs — and that's intentional for MVP (Nikunj adapts scripts
with Claude Code). An autonomous optimizer would have to either work within
those thin tools or build the missing layer.

The realistic near-term shape is **human-in-the-loop optimization**: a designer
runs the suite, the loop surfaces a red cell with a transcript, the designer
diagnoses (or asks Claude Code to diagnose) which layer to edit (see [the
investigation order in test-driven-prompts.md](test-driven-prompts.md#when-red-what-to-change)),
makes the change, re-runs. That's the MVP loop today and it works.

Note that most of those layers — assertions, variable bundles, spec flow
content, spec variables, and model selection — live in the customer's own
agent repo and are editable in place. The one exception is the prompt
generator itself (`packages/core/src/codegen/promptGenerator.ts` in `flowstore`),
which requires a cross-repo change because a generator edit affects every flowstore
spec everywhere. That's the right altitude for class-of-problem fixes but a
real seam for an autonomous loop running entirely inside one customer's repo:
the loop can identify a generator-layer fault but not fix it without
escalating.

Fully autonomous optimization is gated on the LLM-judge wiring (item 1 above)
because without it the optimization signal is too narrow. Everything else is
incremental.
