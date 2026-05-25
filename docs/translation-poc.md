# Translation PoC: LangGraph Fidelity

> **Outcome (Day 11-12, 2026-05-23): SUCCESS — fidelity holds, including
> under live LLM.** Synthetic harness: 5/5 scenarios pass equivalence on
> flow path, final variables, and final exit. Live-LLM regression (Gemini
> 2.5 Flash via Vertex, temperature=0, N=3 per surface per scenario):
> runner == translated dispatch on 6/6 live runs across L_HP1 (happy) and
> L_HP2 (invalid policy). Zero intra-surface drift.
>
> See [FINDINGS.md](../flowstore-runner/docs/langgraph-poc-findings.md).
> Live regression caught two bugs the synthetic harness couldn't: a
> prompt-shape divergence (missing guardrails / example) and conversation
> history dropped on exit-fire transitions. Both fixed in the translator.

A bounded experiment to answer one strategic question with evidence rather than theory: **does translation from a flowstore v0 spec to a graph-native runtime (LangGraph) preserve the flow / exit / capture / variable semantics the runner enforces, with enough fidelity to be useful for production deployments?**

This is a spike. Deliverable is *evidence*, not a shippable translator.

## Why

The translation strategy laid out in [`TRANSLATIONS.md`](../TRANSLATIONS.md) names three structural classes of export targets. The strategic question — whether to invest meaningfully in graph-native translators as the short-term production path for spec-shaped agents — depends on behavioral fidelity holding in practice, not in theory.

LangGraph is chosen for this PoC because:

- Its structural mapping to flowstore is the cleanest of any target (graph nodes, typed state, conditional edges, native interrupts).
- Text-mode validation is faster to instrument than voice. Text mode is already first-class in the runner ([`server/text_session.py`](../flowstore-runner/src/flowstore_runner/server/text_session.py)).
- Lower implementation risk than Pipecat (which reintroduces tool-call atomicity concerns in the routing decision path).

If LangGraph fidelity holds, the same experiment shape rolls forward to Pipecat on a hardened IR. If it doesn't, that's strong evidence to weight the runner-as-production path over translation-as-production.

## What decision this gates

After the PoC:

- **Fidelity holds** → invest in generalizing the LangGraph translator and formalizing the harness; begin Pipecat translator on the same IR. Translation becomes the short-term production path per the strategy in TRANSLATIONS.md.
- **Fidelity diverges on identifiable categories** → named gaps to address before generalizing; smaller targeted investment to close them.
- **Fidelity fundamentally breaks** → reweight toward runner-as-production-runtime. Translators become escape-hatch for specific customer deals, not the strategic production lever.

The PoC is falsifiable. The outcome should shape next-quarter investment; if it wouldn't, don't run the experiment.

## Scope

**In:**

- FNOL spec only (small, real, currently being authored against).
- Text mode only.
- LangGraph target only.
- Translator coverage limited to the spec features FNOL actually uses.

**Spec features covered:**

- `variables` with type annotations → Pydantic state schema.
- `capabilities` of `kind: function` over HTTP → `@tool` functions.
- `flows` with entry/exit semantics → graph nodes.
- `exit_paths` with `calculation` conditions → conditional edges via ported expression eval.
- `exit_paths` with `llm` conditions → conditional edges via LLM-judgment helper.
- `exit_path.actions` → capability invocation with output binding to state (per the capability-output binding decision in [RUNNER-PLAN.md](../flowstore-runner/docs/runner-plan.md)).
- `entry_condition` on flows → guards before node entry.
- Per-flow system prompts composed from spec scripts + persona.
- `agent.chatbot_initiates` → entry node sends opening turn.

**Out of scope:**

- Multilingual (one language only).
- Interrupts. FNOL *does* declare four interrupt flows (`int_human_handoff`, `int_policy_question`, `int_calming`, `int_cancel_claim`), contra an earlier note in this doc. Translator skips them; scenarios are restricted to the linear happy/sad path that never triggers an `entry_condition`. Interrupts become the next experiment if dispatch fidelity holds on the linear path.
- Knowledge.faq / knowledge.glossary (only used by the skipped interrupt flows in FNOL).
- `business_goals` (post-hoc evaluation, not dispatch).
- Voice-specific anything.
- MCP capabilities (HTTP only).
- Productionization of the translator — this is a spike.
- Editor integration.

**Additional spec features in FNOL beyond the original list:**

- `capabilities` of `kind: retrieval` (treated identically to `function` for the PoC — both are HTTP calls with input/output bindings).
- `exit_path.assigns` with `method: direct` (set a variable to a literal value before firing actions).
- Utility flows (`type: utility`, no scripts) — pass through with no agent turn, route purely on `calculation` exits.
- Script string interpolation (`{policy_number}`, `{claim_id}`) — resolved at turn time from current state.
- Default-else exit paths (no `condition` block) — last-resort branch.

## Architecture

```
flowstore-runner/
  experiments/langgraph_poc/
    __init__.py
    translator.py         # flowstore spec → Python source
    runtime_helpers.py    # Shared expression eval, capability mock, LLM helper
    generated/
      fnol.py             # Translator output
    test_fidelity.py      # Harness + scenarios
    fixtures/
      capabilities.json   # Shared mock returns for runner + translated
```

Why this location: the harness needs runner internals to play scenarios through `TextSession`, so the code lives next to the runner. If the translator productizes after the PoC, it moves to `../flowstore/packages/core/src/codegen/langgraph/` to join the editor's codegen pipeline.

### Generated artifact shape

```python
# generated/fnol.py
from langgraph.graph import StateGraph
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.tools import tool
from pydantic import BaseModel
from runtime_helpers import eval_expr, call_capability, llm_turn

class FNOLState(BaseModel):
    policy_number: str | None = None
    policy_active: bool | None = None
    # ... derived from spec.variables

@tool
async def verify_policy(policy_number: str) -> dict:
    return await call_capability("verify_policy", {"policy_number": policy_number})

INTAKE_PROMPT = """..."""   # composed from spec scripts + persona

async def flow_intake(state: FNOLState) -> dict: ...
async def flow_verify(state: FNOLState) -> dict:
    result = await verify_policy.ainvoke({"policy_number": state.policy_number})
    return {"policy_active": result["policy_active"]}

def route_after_verify(state: FNOLState) -> str:
    if eval_expr("policy_active != True", state): return "policy_invalid"
    return "claim_details"

graph = StateGraph(FNOLState)
# ... add nodes, edges
app = graph.compile(checkpointer=MemorySaver())
```

Conversational pause for user input uses LangGraph's `interrupt()` + checkpointer pattern. Each flow node either yields-for-user (interrupt) or routes deterministically (when exit_path conditions resolve without needing a turn).

### Test harness shape

```python
# test_fidelity.py
SCENARIOS = [
    {
        "name": "happy_path",
        "fixtures": {"verify_policy": {"POL-123": {"policy_active": True}}, ...},
        "user_turns": ["I need to file a claim", "POL-123", ...],
        "expect": {
            "flow_path": ["intake", "verify", "claim_details", "file", "confirm"],
            "final_vars": {"policy_active": True, "claim_id": "CLM-001"},
            "final_exit": "confirm_filed",
        },
    },
    # 3-4 more
]

async def run_runner(spec, scenario): ...    # TextSession with mock capabilities
async def run_translated(scenario): ...      # compiled LangGraph app, same fixtures
def assert_fidelity(runner_trace, translated_trace, expected): ...
```

## Equivalence criteria

The PoC validates **dispatch logic**, not wording.

- ✅ Same flow transition sequence — both surfaces visit the same flows in the same order.
- ✅ Same final variable state — every variable referenced in the scenario has the same value at the end.
- ✅ Same final exit decision — the terminal exit path matches.
- ❌ Same per-turn text — out of scope. LLM nondeterminism defeats text-level comparison even at temperature 0, and wording isn't what translation is supposed to preserve. Phrasing fidelity is a separate concern.

## Scenarios

Minimum four; an optional fifth if time allows.

1. **Happy path** — full FNOL flow with valid policy, claim filed successfully.
2. **Invalid policy** — `verify_policy` returns `{policy_active: False}`; route through the invalid-policy branch.
3. **Capability failure** — `verify_policy` raises; `policy_active` stays undefined; downstream `var != True` branches fire correctly. Validates the "Failure → undefined" semantic from the [capability-output binding decision](../flowstore-runner/docs/runner-plan.md).
4. **Missing capture** — user gives incomplete info mid-flow; flow re-prompts; eventually captures and proceeds. Validates capture loop behavior.
5. **(Optional) Calculation branch** — exit path with a non-trivial expression (date comparison, multi-variable condition). Validates expression eval port.

## Effort & sequencing

| Day | Work |
|---|---|
| 1 | Pick FNOL spec; hand-translate to LangGraph on paper. Validate every spec feature has a target equivalent. Smoke out gaps before writing code. |
| 2 | Wire `runtime_helpers`: expression eval (port from [`expressions.py`](../flowstore-runner/src/flowstore_runner/dispatcher/expressions.py)), `call_capability` with fixture lookup, `llm_turn` / `llm_judge` helpers. |
| 3-4 | Build translator: walk `LoadedSpec`, emit Python source for state schema, tools, flow nodes, conditional edges, graph construction. |
| 5 | First end-to-end run of generated `fnol.py` against a hardcoded scenario. One happy path green. |
| 6 | Test harness: scenario runner for both surfaces, fixture injection, trace comparison helpers. |
| 7-8 | Write 3-5 scenarios; run both surfaces; debug divergences. Most likely failure modes: condition expression semantics, capture extraction differences, output binding timing. |
| 9-10 | Iterate to green or characterize the divergence cleanly. |
| 11-12 | Write up findings: what passed, what diverged, what the divergences teach us. |

~10-12 focused days, ~2-3 calendar weeks.

## Upfront decisions

1. **LangGraph version** — pinned at `langgraph==1.2.1` with `langchain-core==1.4.0`, added to `flowstore-runner` dev deps. Note: the checkpointer is now `InMemorySaver` (under `langgraph.checkpoint.memory`), not `MemorySaver` as described elsewhere in this doc.
2. **Conversational pause mechanism** — `interrupt()` + `InMemorySaver` checkpointer. **Spike result (Day 1, [`spike_interrupt.py`](../flowstore-runner/experiments/langgraph_poc/spike_interrupt.py))**: all four patterns work end-to-end without an LLM: (a) `interrupt()` pause + `Command(resume=user_text)` resume; (b) `Command(goto=<self>, update={...})` self-loop for stay-in-flow; (c) back-edge cycles (sad → retry → happy → sad again) with state persisting across cycles; (d) pure conditional `Command(goto=...)` utility flows with no LLM and no interrupt. Two PoC-relevant idioms confirmed: additive state channels need `Annotated[list, operator.add]` reducers, and superstep-keyed checkpoints handle re-entry of the same node id cleanly.

   **F3 (Day 5) — LLM duplication on resume.** LangGraph replays the pre-`interrupt()` half of a node body on every resume. A naïve emit (`_resp = await llm_turn(...)` before `interrupt()`) calls the LLM twice per user-facing turn — unacceptable for cost, latency, and determinism. **Resolution: wrap `llm_turn` in `langgraph.func.task`**. Tasks are checkpointed by LangGraph; the cached return is replayed on resume instead of re-executing. With `@task`, the FNOL happy path runs exactly one LLM call per scripted user turn (verified: 19 stub calls for 19 scripted turns). Translator now emits a module-level `@task`-decorated `_llm_call` wrapper.

3. **Interrupt resume payload** — dict form, not bare string. Original `Command(resume=user_text)` couldn't deliver state captures (e.g. `caller_name`, `callback_number`) because `app.update_state(config, dict)` outside interrupt resume *ends* the graph (terminates the pending interrupt's checkpoint). Translator now emits `interrupt()` consumers that accept either a plain string OR `{"text": ..., "captures": {var: value, ...}}`, merging captures into state on resume. Test harnesses use the dict form; production code with a real LLM uses the string form.
3. **Capability mock injection** — both surfaces read the same `fixtures/capabilities.json`. The runner gets a `MockCapabilityDispatcher` injected via existing config seams; the translated runtime's `call_capability` reads the same file.
4. **LLM provider** — same as runner (Vertex Gemini), via LangChain's `ChatVertexAI`. Same temperature (0). Same credentials. Maximum reproducibility.
5. **Expression eval handling** — copy the runner's logic from [`expressions.py`](../flowstore-runner/src/flowstore_runner/dispatcher/expressions.py) into `runtime_helpers` for the PoC. Don't share Python modules across surfaces yet; productize later if the PoC succeeds.

## Risks

- **Prompt fidelity divergence.** Runner's prompt assembly and translated agent's per-flow prompts will differ in structure. Even at temp 0 with the same model, decisions may drift. Mitigation: align prompts as closely as practical; equivalence target is "same dispatch decisions," not "same prompts."
- **Conversational state mechanics.** LangGraph's `interrupt()` + checkpointer pattern has its own quirks. Mitigation: 30-min spike before committing; budget 1 day buffer.
- **Mock backend consistency.** Drift in fixture-loading code between runner and translated surfaces would cause boring divergences. Mitigation: shared `capabilities.json` schema and shared loader.
- **LLM nondeterminism even at temp 0.** Mitigation: equivalence criteria don't compare text; run each scenario multiple times and require consistent dispatch decisions across runs.
- **Spec gaps surfaced mid-PoC.** FNOL may exercise a feature the translator design doesn't handle. Mitigation: day-1 hand-translation flushes most of these; budget 1 day buffer for the rest.
- **Information value depreciation.** If the next quarter's plan doesn't change based on the outcome, the PoC is academic. Mitigation: commit to the go/no-go below before starting.

## Go / no-go criteria (post-PoC)

**Success looks like:** all 4 scenarios pass equivalence on flow path + final vars + final exit. Translator covers all FNOL features. Divergences, if any, are explainable and addressable.

→ Generalize the translator to cover the full schema. Formalize the harness (golden trace generation, scenario authoring tooling). Begin Pipecat translator on the same IR. Update [`TRANSLATIONS.md`](../TRANSLATIONS.md) with concrete fidelity results.

**Partial success looks like:** scenarios diverge on identifiable categories (e.g., `llm` conditions drift, `calculation` conditions hold). Specific gaps named.

→ Address the named gaps before generalizing. Reassess whether they're addressable in the translator or indicate a structural limit of LangGraph-as-target.

**Failure looks like:** scenarios diverge unpredictably with no clear pattern, or diverge in ways that require fundamental reshaping of either the translator or the runner.

→ Reweight toward runner-as-production. Per [TRANSLATIONS.md](../TRANSLATIONS.md), the runner already absorbs Pipecat for voice; growing it for production becomes the dominant path. Translators stay escape-hatch for specific deals. Document what failed and why — the negative result is itself valuable evidence.

---

## Pipecat translator — status and what's blocking it (as of 2026-05-23)

**Status: planned but not started. Blocked on integration contract from Awaaz.**

### Why we want it

The strategic target for translation is **deployment on Awaaz** (and platforms like Azure Cloud that accept Pipecat workloads). Awaaz already runs Pipecat agents in production — multiple Tala deployments across India, Mexico, and Philippines are on Pipecat with sub-2s latency, with new use cases being migrated to Pipecat throughout 2026. The flowstore editor's value proposition lands when a designer can author a spec and have it run alongside the hand-written Tala agents on the existing Awaaz infrastructure.

This is a different framing than the LangGraph PoC. LangGraph was a *behavioral fidelity* experiment — answering whether translation can preserve dispatch semantics in principle. Pipecat is an *integration* experiment — answering whether we can emit a drop-in replacement for a hand-written Tala agent that Awaaz can load and run as-is.

### Why we can't start yet

Every meaningful structural decision for the Pipecat translator depends on knowing Awaaz's integration contract. Three open questions:

1. **Entry point**: what function does Awaaz call on a deployed agent file? Possibilities: `run_session(connection, config)`, `build_pipeline(services) -> Pipeline`, a module-level constant, something else. Determines the top-level shape of the generated file.
2. **Service injection model**: does Awaaz construct the Pipecat services (transport, STT, TTS, LLM) and inject them, or does the agent file construct them? Determines whether the generated file imports `GoogleSTTService` etc. or accepts them as parameters. Also determines how credentials flow in.
3. **Required interface beyond standard Pipecat**: capability registration, lifecycle hooks, observability requirements, any non-Pipecat APIs the agent must expose to be deployable.

Building blind would mean choosing a file shape and rewriting it once Awaaz tells us their actual contract. The dispatch logic (route-tag parsing, capability dispatch, frame processors) is mostly portable from the LangGraph translator, but the *emission shape* — what the generated file looks like at the module level — is entirely a function of Awaaz's contract.

### Question to send to Awaaz

The minimum useful ask:

> Three quick questions on integrating a Pipecat agent with Awaaz: (1) what entry point does Awaaz call on the agent file, (2) does Awaaz or the agent construct the Pipecat services (transport / STT / TTS / LLM), and (3) is there a required interface beyond standard Pipecat — capability registration, lifecycle hooks, etc.? An example of an existing agent's top-level file would answer all three in one shot.

An example file is the highest-leverage outcome — it implicitly answers all three.

### Pre-decided design choices (independent of Awaaz)

While waiting, several design choices are settled enough to lock in:

- **Interpretation A** (per-flow logic codegen'd, not interpreted at runtime). Generated file is spec-specific Python; the dispatcher is hard-coded into the emitted code rather than reading `LoadedSpec` at runtime. This is what makes it a "translator" rather than "the runner running on Awaaz's infrastructure."
- **In-text route tags, not Pipecat tool calls.** The runner explicitly chose in-text tags to avoid tool-call atomicity issues at flow transitions. The Pipecat translator inherits the same protocol — we already know it works (live LLM regression confirmed it).
- **File + small runtime shim.** Generated file imports from `flowstore_pipecat_runtime.py` (route-tag parser, expression eval, capability dispatch — most of which already exists as `runtime_helpers.py` in the LangGraph PoC). The shim is stable across specs; only the generated file is spec-specific.
- **Generated pipeline emits standard Pipecat metrics only.** No flowstore-specific event stream. Awaaz/Azure get whatever observability they normally have. Simpler to ship.
- **Text mode first, then voice.** Same model as the LangGraph PoC: validate dispatch fidelity in text mode where the harness already exists, then push through to voice (WebRTC + Silero VAD + Cloud STT/TTS) once text holds.
- **Same FNOL spec.** Don't conflate "does Pipecat translation work" with "does cross-spec generalization work" — those are separate unknowns.

### What we can reuse from the LangGraph PoC

Everything except the LangGraph-specific emitter:

- Scenario shape (`Scenario`, `Turn`, `Fixtures`, `ExpectedTrace`).
- All 7 synthetic scenarios + 3 live scenarios.
- Dual-surface harness pattern (runner vs translated, dispatch_trace comparison).
- Ported runtime helpers (expressions, route-tag parser, resolve_localized, substitution, match_pattern, capability registry).
- Parity test pattern.

The substantive new work is: the Pipecat code emitter (translator.py equivalent), the Pipecat-side test driver (analog of `run_translated` that runs a Pipecat pipeline instead of a LangGraph app), and voice-mode validation infrastructure.

### Phased plan (when Awaaz unblocks)

Rough ~3-4 day estimate from the existing harness baseline:

1. **Phase 1 (½ day)**: read the Awaaz reference file (if provided); finalize the generated-file structure. Port the runner's `PreLLMPlanner` / `RouteTagFrameProcessor` / `PostLLMResolver` into the runtime shim and verify they work standalone.
2. **Phase 2 (1 day)**: minimal Pipecat translator covering 2-3 flows; single happy-path scenario passes.
3. **Phase 3 (1 day)**: full FNOL coverage; synthetic 7/7 regression must pass.
4. **Phase 4 (½ day)**: live regression in text mode (L_HP1, L_HP2, L_HP3 via a frame-injection test transport).
5. **Phase 5 (1 day)**: voice-mode regression — drive a real audio conversation through the translated pipeline; confirm dispatch traces still match.
6. **Phase 6 (½ day)**: write up.

### Pre-known risks for Pipecat (carried forward from this PoC)

- **Tool-call atomicity** — avoided by using in-text route tags (same protocol as runner). Not a Pipecat-only risk anymore; settled by the LangGraph PoC.
- **Empty-reply LLM behavior** — same fix as LangGraph translator (strong prompt directive + utility-flow LLM call). Should carry over directly.
- **Pipeline-level state sharing** — Pipecat pipelines are static; per-session state lives on a shared `Session` object the processors close over. Generated translator must thread this correctly.
- **Voice-mode specifics** — VAD, mid-response barge-in (`InterruptionFrame`), TTS streaming. Not exercised by the LangGraph PoC at all; first appearance is in Phase 5.
