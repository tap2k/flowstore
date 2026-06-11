# Persona simulation: layering, traits, and drift

How a **persona** (the LLM playing the user side of a test) turns into a runnable
prompt, and the deliberate boundaries around it. Personas are part of the
**testing sidecar** (`flowstore://test/...`), not the core agent spec — keep
simulation concerns out of `agent.json`.

## The layers

A persona is **declarative data**: identity + scenario, plus an open `traits`
bag. The runnable user-sim prompt is composed at **run time** by whoever drives
the persona (today: the browser sim and the Python harness):

```
system prompt  =  persona.system_prompt          (identity + scenario — authored/generated)
               +  renderTraits(persona.traits)    (open knobs, one `key: value` line each)
               +  defaultPersonaInstructions(modality)   (the rail — invariants + medium form)
```

Three distinct layers, each at its own altitude:

1. **Persona data** — *who* the user is and *why* they're contacting the agent.
   Portable; the only thing stored.
2. **The rail** (`defaultPersonaInstructions`, `runtime/personaClient.ts`) — generic
   "how a simulated user behaves on this medium": role-lock, stay-in-character,
   reply in the agent's language, length/form per modality, `[DONE]`. A **single
   non-parametrized string per modality**. Not baked into the persona — flip the
   agent's modality and every persona re-tunes on the next turn.
3. **Channel perturbation** (harness-side `asr_shape`, barge-in) — mechanical,
   deterministic, *seeded* transport corruption. Deliberately **not** in the
   prompt: an LLM can't be reliably told to garble itself, and this layer must
   stay seeded for regression. See the harness `_voice.py` helpers.

## Why the rail is a single non-parametrized string (and not trait-parametrized)

Collapsing the rail to one constant per modality makes cross-harness drift a
**three-string sync problem** instead of a combinatorial-renderer problem.
Traits are **appended** as a raw `key: value` block, not woven into the rail.

This works only while the rail and traits stay **orthogonal**: the rail owns
*medium form*, traits own *disposition/amount*. There is one latent collision —
the rail currently bakes a length opinion ("one short spoken sentence"). That is
fine **today** because no trait governs length.

> **Migration trigger:** the first time a length/verbosity trait is introduced,
> strip the length claim out of the rail (it moves to the trait), or the two
> will contradict. This is the canonical example of the deferred
> *trait-specific rail switches* — when traits need to *change* rail wording
> rather than sit beside it, that's when the rail earns parameterization. Until
> then: append, don't parameterize (YAGNI).

## Traits

`persona.traits` is an **open** `Record<string, string|number|boolean>` — the one
sanctioned extension bag (the persona envelope stays `additionalProperties:
false`, so typos in real fields still error). Kept open on purpose: no fixed
vocabulary until grid-generation/pivoting earns typed enums.

- **Render rule:** every key prints verbatim as `- key: value`.
- **Machine-read keys** (e.g. `barge_in`, consumed by a voice harness's
  perturbation/loop) also render today as harmless noise. If that ever matters,
  reserve a skip convention (e.g. a `_`-prefix) rather than a hard-coded denylist.
- **Orthogonality / sweeping:** a test case may override a trait per key (like
  `vars`), which is what keeps channel knobs an orthogonal *sweep* axis rather
  than persona-intrinsic. Channel realism conceptually belongs on the
  test/run axis, not baked into the persona.

## Drift between harnesses

The browser sim and the Python harness each drive personas independently, so the
rail string and the traits-render are a shared contract. Strategy:

- **Now:** the canonical rail lives in core; both harnesses keep it in sync. Pin
  it with a **conformance fixture** (golden rail per modality) both repos test,
  so divergence is *caught*, not trusted.
- **Deferred:** the automated breach is a `flowstore-compile --format persona`
  boundary (the Python side already shells to `flowstore-compile` for the agent
  prompt) — one renderer, consumed everywhere. Land it with the trait-switch work.

Drift is treated as **emergent**, not a first-class goal: get the declarative
contract + single renderer right and it collapses out.

## Forward-compat: strictness follows authorship

- **Hand-authored** files (persona, case, gold) stay strict
  (`additionalProperties: false`) so authoring typos surface.
- **Machine-written** artifacts (`result`) are open at the top level so a newer
  runner adding fields doesn't break an older reader.
- **Loader** tolerates an unrecognized `$schema` on a recognized path (a newer
  version / future kind): skipped, but **surfaced** via `LoadResult.testingArtifacts.ignored`
  — never silent. A silent skip turns a `$schema` typo into an invisibly
  vanished test (suite goes green with the case missing). A *recognized*
  `$schema` with bad fields is still a hard error.

## Known smell (deferred refactor)

Persona-simulation code (`personaClient.ts`, `personaGen.ts`, the turn loop)
currently lives in `@flowstore/core/runtime`, next to the **product** agent
runtime — sidecar logic sitting in core product code. It should move to a
testing module/package. Out of scope for the current change; tracked here.
