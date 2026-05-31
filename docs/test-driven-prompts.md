# Test-driven prompt engineering

Audience: anyone authoring or iterating on a flowstore agent — designers, prompt authors, engineers. This is the **methodology** for using a script harness as a development loop. For the mechanics it stands on (the compile contract, file shapes, the result contract, mock dispatch), see [testing-from-scripts.md](./testing-from-scripts.md).

The short version: **write the conversations you want before the prompt that produces them, then iterate the spec / generator / runtime until the harness goes green.** The long version is below. Examples use the neutral [`examples/coffee`](../examples/coffee) spec; the worked instances are [fnol](https://github.com/tap2k/flowstore-example-fnol) and [awaaz](https://github.com/tap2k/awaaz-dpd31).

---

## Why TDD for prompts at all

A system prompt is code with no compiler. You can change a sentence in a flow's `instructions`, recompile, and have no idea whether it made anything better or worse without running real conversations through it. Worse: the change might fix the case you cared about and silently break three others.

The common workaround is "vibe testing" — paste the prompt into a chat UI, try a few inputs, eyeball the replies. It doesn't scale past one author and one revision, and it optimizes for the cases the author can hold in their head, which are not the cases that fail in production — the customer who can't answer cleanly, the backend that 503s mid-call, the user fishing for an answer you don't want to give.

The dynamics that motivated TDD for code apply:

- **A failing test pins down what "broken" means** before you start fixing. Without it, every prompt change becomes a debate about taste.
- **A green suite gates whether a change ships.** A generator improvement that passes 7 cases and breaks 1 is visible.
- **Regression coverage compounds.** The case that bit you once becomes a permanent guardrail.

Two differences from code TDD shape everything below:

1. **The system under test is non-deterministic.** Pinning `temperature=0` reduces but doesn't eliminate variation — provider stacks still vary. A single green run is weaker evidence than a unit test. See [Trials](#trials-and-re-running).
2. **The "test" is a gold-standard conversation + acceptance criteria**, not a unit test of a function. Authoring the test is half the work; the assertion vocabulary that makes it *actually test what you mean* is the other half. See [Authoring assertions](#authoring-assertions).

---

## The loop

```
  ┌────────────────┐        ┌────────────────┐
  │ gold transcript│        │  spec / prompt │
  │ (tests/gold/*) │        │  generator     │
  └───────┬────────┘        └────────┬───────┘
          │                          │
          │     ┌──────────────┐     │
          └────▶│  test case   │◀────┘
                │ (assertions) │
                └──────┬───────┘
                       │
                       ▼
              ┌──────────────────┐
              │  your runner     │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐   GREEN: ship, expand coverage
              │ result.json      │──▶
              │ tests/runs/…     │   RED:  diagnose mechanism, fix
              └──────────────────┘        spec / generator / runtime, re-run
```

Five phases, each with a concrete artifact. The order below is how you do it the *first* time for a new agent or scenario; after that you re-enter at phase 3, 4, or 5 most of the time.

### Phase 1 — gold transcripts

A **gold** (`tests/gold/<id>.gold.json`, `flowstore://test/gold/v0`) is a verbatim example conversation. It is *not* a rule about what the agent should do (that's the spec) — it's a captured trajectory through whatever rules apply.

Three sources, in order of preference:

1. **Customer-provided gold-standard docs.** The best source — labelled scenarios with verbatim turns. Many customers already have these; ask explicitly.
2. **Production recordings / QA-tagged transcripts.** Higher signal than synthetic — real users surface phrasings you wouldn't invent. (Privacy considerations apply.)
3. **Hand-authored synthetic golds.** Fine for bootstrapping. Author them *thinking like an adversary*: every gold should target one routing decision, one guardrail, or one edge case you suspect will misfire.

**Extracting golds from existing material.** Both worked repos carry a `GOLD-EXTRACTION-PROMPT.txt` — an LLM prompt you feed customer source docs to emit one gold record per example conversation in the source, with a no-hallucination discipline (no example conversations in the source → empty output, which is itself the answer to "what do we need from the customer?").

### Phase 2 — derive test cases from golds

A gold is the source of truth; a **test case** (`tests/cases/<id>.test.json`, `flowstore://test/case/v0`) is the executable extraction. The case carries the user side of the gold's turns plus assertions over what the agent must (or must not) say, the persona that supplies the world, the evaluators, and a `gold_id` back-pointer the rubric judge reads for side-by-side comparison.

You can hand-author the case from the gold, or derive it mechanically: bundle each gold with the compiled spec, prompt a model to pick distinctive substring assertions from the actual flow scripts and negative assertions seeded from the guardrails, then write the case. (awaaz ships a `CASE-FROM-GOLD-PROMPT.txt` and a `derive_cases.py` that does this.) Either way, review the substring choices — routing-distinctive language needs a human eye, and an over-literal assertion fails on benign paraphrase.

### Phase 3 — compile the spec to a prompt

The runner compiles for you, but to inspect what the model actually sees, compile by hand (see [testing-from-scripts.md § Compiling](./testing-from-scripts.md#compiling-the-spec)). This is the layer you'll iterate on most once cases exist. Three things you can change, in order of cost:

- **Persona world** (cheap) — edit the bound persona's `vars` / `mocks`. "What does the open look like if the customer is already identified?" or "what happens when `place_order` errors?"
- **Spec content** (medium) — edit `flows/*.flow.json`, the per-flow `*.scripts.csv`, `knowledge/`, or guardrails. Each change recompiles instantly; re-run the suite to see effect.
- **Prompt generator** (high) — change the flowstore compiler itself. Affects *every* spec. Reserve for class-of-problem fixes, not one-off tweaks.

### Phase 4 — run the harness

Run the case through your runner; it writes one `run/result/v0` file to `tests/runs/<UTCstamp>-<label>/`. The three common drivers: scripted (`user_turns`), persona-driven (LLM-as-user), and decision tests (one prefix, many branch inputs).

### Phase 5 — read the result and decide

The `result.json` is the artifact you actually look at. `evaluator_results[]` carries one entry per check with `passed` (boolean) or `score` (rubric) plus `notes`. Three outcomes:

- **PASS** — for a deterministic substring/regex/count check, a real green; for a rubric, a green *this run*.
- **FAIL on a deterministic check** — the evaluator never matched. Diagnose mechanism: the model paraphrased a script so the literal didn't appear, the wrong flow fired, a `{placeholder}` leaked unrendered, or the assertion is too strict.
- **FAIL on a rubric / persona run** — could be a real regression or model variance. Re-run before concluding.

For each failure, **read the actual transcript in the result** before drawing conclusions. The difference between "the agent did the right thing but didn't say the magic word I asserted" (fix the assertion) and "the agent took the wrong branch" (fix the spec or generator) is usually obvious in the transcript and invisible from the pass/fail alone. When you fix something, re-run the case *and its neighbors* — if only the targeted check improved and nothing regressed, ship.

---

## Authoring assertions

The assertions are the contract. Bad ones silently legitimize bad behavior or fail loudly on benign paraphrase. Rules that prevent the common failures:

- **Anchor on script-distinctive phrases, not generic words.** A capability's mocked output (e.g. an `order_id`) appears *only* when that capability actually fired — asserting it pins the behavior, not just friendliness. Prefer those over a generic "thanks."
- **Pair positive with negative when a guardrail is in play.** Asserting `must_contain` is often necessary but not sufficient; the matching `must_not_contain` on the same turn is what turns a routing check into a guardrail check (e.g. "offered the menu" *and* "did not ask for payment first").
- **Guard against fabrication with negative regex.** If the agent must never invent an id when an action failed, assert that id-shaped pattern with `must_appear: false`. This is often the single most load-bearing assertion in robustness cases.
- **Always assert the no-leaked-placeholder regex on happy paths:** `{ "kind": "regex", "pattern": "\\{[a-zA-Z_][a-zA-Z0-9_]*\\}", "must_appear": false }`. Cheap, and it catches a whole class of generator/variable-binding bugs (an un-substituted `{order_id}` leaking into a reply).
- **Prefer `capability_assertions` over fishing for a mock's return value.** "Did the agent place the order?" is `{ "capability": "cap_place_order", "invoked": true }` — deterministic and provider-neutral — not a substring hunt for the order id in prose.
- **Substring matching is case-insensitive but literal.** "A LARGE oat latte" passes `must_contain: ["latte"]`; "your usual" does not. For paraphrase tolerance you want a rubric (LLM judge), a different evaluator category. Use rubrics for tone and outcome; substrings for hard facts.
- **1–3 deterministic assertions per case.** Too few and you can't tell what failed; too many and every revision is a noisy red parade. Assert the load-bearing routing decision and one guardrail check, then stop. Push softer "did it stay warm / did it deflect" judgments into rubrics.

---

## Trials and re-running

`temperature=0` is the floor on variation, not the ceiling. A single green is weaker evidence than a code unit test.

- **Scripted and decision runs** are usually stable enough at temperature 0 for deterministic checks — the mocked id either appeared or it didn't, and it rarely flips. When you suspect flakiness, re-run by hand and diff the result dirs.
- **Persona runs** are the genuinely non-deterministic case (the simulated user improvises). Run them at `--trials N` (the reference runners record each trial under `result.trials[]`) when a rubric verdict is what you're trying to call reliable.
- **Don't optimize "to N/N forever."** Some variance is structural. The bar is "reliable enough for the use case" — low for a benign paraphrase, much higher for a safety- or compliance-critical check, where any miss is a real failure rate worth treating as red.

---

## When red, what to change

Order of investigation, cheapest first:

1. **The assertion.** Right turn? (`turn` is 1-indexed into the *agent-only* subsequence.) Distinctive enough? Did the model paraphrase a script your literal assertion is too tight for? Should it be a rubric?
2. **The persona world.** Are the bound persona's `vars` correct for the scenario, and does each capability mock return what this routing decision needs (e.g. a success vs an error result)? A wrong world makes a routing assertion impossible to satisfy.
3. **The spec — flow content.** Did the routing condition on the relevant exit match what the user said? For `llm`-method exits, is the `expression` clear? For `calculation`-method exits, is the variable it reads actually being set? Is the flow's `instructions` unambiguous?
4. **The spec — variables / scripts.** Is the referenced variable declared? Does a script template a `{placeholder}` for a variable that never binds (the leaked-placeholder failure)? Is a distinctive phrase missing from the scripts so there's nothing to anchor on?
5. **The prompt generator.** Does the compiled prompt actually contain the routing information the spec encodes? Compile with `--format prompt` and read it. Common: a guardrail rendered weakly; routing alternatives rendered as soft suggestions the LLM treats as optional rather than a gate.
6. **The model.** Under-spec'd for the task? A long multi-flow prompt can strain a fast model. Pin a stronger model on the case and see if half the brittleness disappears for free — worth trying before deeper surgery.

`state_assertions` are a special case of "red for a structural reason": the compiled-prompt target doesn't track scope, so `final_variables` is empty and they report "needs a native runner." Expected — the assertion *shape* is demonstrated; a deployed runner that tracks scope turns it green. Don't chase it on the prompt target.

---

## Comparing prompts (A/B)

Run the same case against two system prompts with everything else held constant (tool schemas, user turns, mocks, model). The lever is `--system-prompt`: by default the case runs against the compiled prompt; pass `--system-prompt PATH` to swap in a hand-authored one while still pulling tool schemas from the compiler (apples-to-apples on capabilities). Tag each run with `--label` so the result dirs sit side by side; `prompt_source` records which produced each.

Two comparisons worth running:

1. **Compiled vs hand-authored** — the migration check. Are we losing behavior the source prompt had? Are we *gaining* behavior the source missed?
2. **Compiled vs compiled, generator-improved** — the regression check. Does a generator change improve the targeted case without regressing others?

---

## Anti-patterns

- **Writing the case without a gold.** Tempts you to assert what *you think* the prompt should say, not what a real call would say. The gold is what makes the case defensible in review.
- **One assertion per turn, every turn.** Over-asserting locks the spec into one phrasing forever. Reserve deterministic assertions for load-bearing properties; let rubrics handle soft judgments.
- **Treating a flaky persona pass as a stable green.** A rubric that passes once and fails on re-run means a real failure rate. Run at `--trials N` and look at `result.trials[]`.
- **Ignoring the A/B diff because "both passed."** Two prompts that both pass the assertion can differ in important non-asserted ways. The transcripts are worth a read even on green.
- **Mixing fixture changes with logic changes in one diff.** Change a persona's `vars` and a flow's `instructions` in the same commit and you can't tell which moved which result. Keep them separate.
