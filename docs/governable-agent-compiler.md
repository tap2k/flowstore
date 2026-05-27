# flowstore as a governable-agent compiler (direction)

Status: **proposed direction** (2026-05-27), distilled from a runner design-cleanup +
3-surface accuracy study on the Tala DPD31 spec. This is the *canonical* statement of where
flowstore is heading; the runtime half is `flowstore-runner/docs/supervisor-architecture.md`
(the runner's implementation of the supervisor role under this contract).

## The finding that motivates this

A 3-surface accuracy run (compiled monolithic prompt vs. the graph runner vs. a hand-authored
prompt) showed the **flowstore-compiled monolith matched or beat the graph runner on behavior**
(rubric 4.81 vs 4.33), and the runner's *entire* deficit was one structural boundary bug —
strip it and both sit at 4.78. Every runner bug was a **seam the per-flow decomposition
introduced** (decide-while-speaking, dropped terminator scripts, interrupt blending, per-flow
value stripping). The monolith has no seams.

Conclusion: a frontier model navigates the whole agent graph in-context fine. So the runtime's
job is no longer to *execute the agent for the model* (decompose, drive turn-by-turn) — it's to
**govern an agent the model already runs in-context**. And the thing that can produce a
governable in-context agent — from a structured, validated spec — is **the compiler**.

## The thesis

> **flowstore: prompt compiler → governable-agent compiler.** One validated spec compiles to
> **(a) the in-context monolith** (the model reasons over the whole graph) **and (b) a
> governance manifest** a thin supervisor enforces over a *rented* runtime. **Parity with the
> monolith is the contract.**

The moat is **global-view compilation** — things only a compiler with the whole validated graph
can produce, that neither a hand-written prompt nor an off-the-shelf agent runtime gives you.

## New vs. wheel

**Rent (don't rebuild):** the agent/tool loop, streaming + voice transport, tool dispatch,
tracing, basic guardrail hooks — and the **fast guard LLM** itself (it's just a small model you
call). Text: an agent SDK or a thin provider-SDK harness. Voice: LiveKit / Pipecat / a Realtime
session. The graph runner's original sin was hand-rolling a runtime (a turn-by-turn driver)
instead of renting one.

**Build (the defensible, new part — and what flowstore-compile already is):** the
spec→(monolith + manifest) compile, **data-gates + the compiled guard-LLM policy** (the routing
of one declarative guardrail to the right enforcer), and the parity contract. You rent the guard
*model*; you build the *compiler* that decides what to withhold, what to steer, and what to hand
the guard model. Be the compiler + governance layer on top of a rented runtime; don't build
another runtime.

## Compiler features this implies

Each is tied to something the study actually hit.

### The enabling artifact
1. **Compile to `(monolith prompt + governance manifest)`.** Today: `--format prompt` /
   `--format spec`. Add a manifest the supervisor consumes — data-gates, deterministic steps,
   transition semantics, interrupt priorities, the control-channel schema. One source of truth
   → reasoning + governance. (Everything below populates it.)

### Guardrails & information flow (the differentiator, and the voice answer)
2. **Guardrails compile to three coordinated mechanisms — heavy policy stays *off* the main
   prompt.** One declarative guardrail; the compiler routes it to the right enforcer:
   - **data-gate** (hard, pre-generation, deterministic, **0 inference**): specific-value
     non-disclosure. `no_disclosure_before_identity` → `withhold: [total_due_amount,
     loan_due_date] until: identity_confirmed`. The model never receives the value until allowed
     → it *can't* leak it. The only **real-time prevention on voice** (you can't un-speak).
   - **light proactive steer, kept in the prompt** (prevents drift, cheap): behavioral priors
     like tone / no-threats. Kept deliberately *light* — that's the anti-bloat line, **not**
     "remove them": proactive steering is what *prevents*, and it demonstrably holds (tone stayed
     ~5/5 across the hostile/red-team personas in the study).
   - **fast guard LLM** (reactive, beside the main pathway, not in its prompt): the heavy /
     contextual / auditable policy — *in-path* gate for **text** (block or rewrite before send),
     *out-of-path* monitor + flag for **voice** (can't block the stream, but the violation lands
     in the audit trail). This is where bulk policy logic lives instead of bloating the monolith;
     its policy can itself be compiled from the declarative guardrails.

   Why three and not one: **prevention** (data-gate + proactive steer) and **detection** (guard
   LLM) are complementary, and on **voice prevention beats detection** because detection is
   post-hoc. A guard LLM alone can't carry the prevention half on voice.
3. **Variable availability/visibility as a first-class field** (e.g. `available_after:
   identity_confirmed`). Generalizes the scoped values-block; drives #2. Information-flow
   control compiled from the spec.

### Deterministic content (so the supervisor substitutes, never gambles)
4. **Mark deterministic / canned steps** (`emit: deterministic` on a fixed close). The
   supervisor emits the canonical text verbatim instead of re-asking the model to retype it —
   the fix for the terminator-script-dropped bug.
5. **First-class slot typing in scripts** — `{var}` (deterministic substitution) vs `[llm_slot]`
   (model must fill from conversation). Lets the compiler *decide* a script is
   deterministic-emittable (no `[slots]`) vs needs-LLM, making #4 safe and automatic.

### Global-view features (only the compiler can do these)
6. **Compiler-computed `transition_style` per edge** — whether the destination owns the turn
   (→ silent-route / deterministic-emit) or the source finishes its thought (→ keep). The
   runtime can't see this from one flow's vantage; the compiler can. This moves the
   chatty-boundary fix to compile time.
7. **Interrupt priority / preemption in the schema** — declare ordering + an explicit "preempts
   the current utterance" flag (safety preempts everything). The study found no priority concept
   and a safety interrupt blending with identity steps.

### Validation (fail loud, at compile, not at 2am in a transcript)
8. **Stronger compile-time validation:** interrupts must declare an `entry_condition`; variable
   references must use **canonical casing** (kills the `{Customer_Name}` vs `Customer_Name==`
   latent mismatch); deterministic scripts have no unfilled slots; data-gates reference real
   variables + reachable conditions.

### Testing (codify the assertion-brittleness lesson)
9. **Outcome / rubric assertions as the primary test mechanism**, with verbatim per-turn
   substrings demoted to a tagged exception. Add a script tag (`verbatim_stable` vs
   `paraphrasable`) so the test generator knows what to pin vs. judge by rubric. Substring
   assertions proved brittle across models/prompts (paraphrase, turn-pacing, intent-phrasing);
   rubrics over whole transcripts were robust.
10. **Auto-generate the parity / conformance suite** from spec + golds, and make "runner output
    indistinguishable from the monolith + declared governance" a CI gate. The parity invariant
    becomes a generated artifact, not a manual harness.

## What to build first

The throughline — **#1 manifest + #2 data-gates + #3 variable availability** — is the
defensible core and directly solves the compliance/voice problem (and the scoping was already
prototyped by hand on the runner). Then **#4/#5 deterministic steps + slot typing** (closes the
terminator gap, small) and **#8 validation** (cheap, high-leverage). **#6 transition_style** is
the deepest win but depends on the supervisor consuming the manifest, so it lands after the
supervisor exists.

## The one-line pitch

flowstore becomes the layer that makes an in-context agent **governable and provable** —
data-gated guardrails, deterministic steps, compiler-computed transitions, and a parity
contract, all from one validated spec. Neither a hand-written prompt nor an off-the-shelf
runtime gives you that.

## Caveats

- Holds for graphs that **fit in context** (lean monolith + thin supervisor). For graphs too
  large to inline, decomposition is *forced* and boundary-management becomes the explicit hard
  problem — decompose by capacity need, never reflexively.
- Framework specifics for the rented runtime move fast; verify current capabilities before
  committing to one.
