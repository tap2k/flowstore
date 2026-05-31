# Testing flowstore agents from scripts

Audience: an engineer who wants to drive a flowstore agent through automated tests in Python (or any language). This is the **bring-your-own-runner** path.

flowstore ships two load-bearing pieces and *no runner*:

1. **A compiler** (`flowstore-compile`) that turns a spec into a stable `{system_prompt, tool_schemas}` JSON — a pure function of the spec.
2. **Test-file schemas** (in [`@flowstore/core`](../packages/core/src/schema/files/)) — `test/case`, `test/persona`, `test/decision-test`, `test/rubric`, `test/gold`, `run/result`, validated on load.

How you drive the LLM with that prompt, dispatch its tool calls, and evaluate the transcript is **yours to implement**. Two reference runners exist, both Gemini-driven Python you can read and retarget:

- **[flowstore-example-fnol](https://github.com/tap2k/flowstore-example-fnol)** — the comprehensive one. Capabilities + mocks, multilingual, every test type, gold-comparing rubrics.
- **[awaaz-dpd31](https://github.com/tap2k/awaaz-dpd31)** — an outbound voice agent with **no capabilities** (so no mocks), a batch suite runner, and three run targets (compiled prompt / local runner / deployed endpoint).

This doc is the **mechanics** — the contract across the seam. For the prompt-engineering development loop (golds, assertion authoring, when to fix the spec vs the generator vs the assertions), see [test-driven-prompts.md](./test-driven-prompts.md). The data model is in [SCHEMA.md](../SCHEMA.md); the on-disk layout in [FILE-MODEL.md](../FILE-MODEL.md).

Examples below use the neutral [`examples/coffee`](../examples/coffee) spec (a café order-taker with two capabilities, `place_order` and `log_walkaway`).

---

## The contract

```
  ┌──────────────┐  flowstore-compile  ┌──────────────────────┐
  │  Your spec   │ ──────────────────▶ │ system_prompt + tools│
  │ (dir or json)│                     │  (JSON)              │
  └──────────────┘                     └──────────┬───────────┘
                                                  │
                                                  ▼
                                          ┌───────────────┐
                                          │  your runner  │
                                          │  drives LLM   │
                                          │  + mocks      │
                                          └───────┬───────┘
                                                  │
                                                  ▼
                                         ┌────────────────┐
                                         │ result.json    │
                                         │ (the contract) │
                                         └────────────────┘
```

Three things are load-bearing across the seam:

1. **The compiler** produces a stable `{system_prompt, tool_schemas}` JSON. Your runner drives any LLM with that.
2. **Test cases** (`test/case`) define what to run; **personas** (`test/persona`) own the *world* a case runs in — seeded `vars` and per-capability `mocks` — plus an optional user-side `system_prompt`. A case binds a persona by `persona_id`.
3. **Result files** (`run/result`) are what your runner writes. The shape is contract — the editor's result viewer reads exactly this shape.

Everything else (the evaluator set, multi-trial aggregation, gold loading, endpoint mode) is yours to build.

---

## Compiling the spec

`flowstore-compile` lives in `@flowstore/core`. From a flowstore checkout:

```bash
# System prompt + tool schemas (default language):
npm -w @flowstore/core run --silent flowstore-compile -- examples/coffee/coffee.json --format prompt

# Resolved spec (single runtime-canonical JSON doc — the shape a native runner consumes):
npm -w @flowstore/core run --silent flowstore-compile -- examples/coffee/coffee.json --format spec
```

The input is either a **project directory** (decomposed file-model layout) or a **single spec JSON** (like coffee). Pass directories as an **absolute** path when invoking from elsewhere.

A separate project repo doesn't vendor the compiler — it points at a flowstore checkout through a `FLOWSTORE_COMPILE_CMD` env var that its runner shell-splits and invokes, e.g.:

```bash
export FLOWSTORE_COMPILE_CMD="npm --prefix /path/to/flowstore -w @flowstore/core run --silent flowstore-compile --"
$FLOWSTORE_COMPILE_CMD "$PWD" --format prompt
```

(When flowstore ships a published CLI this collapses to `flowstore-compile`.) Both fnol and awaaz use exactly this override.

### Flags

| Flag | Notes |
|---|---|
| `--format prompt` | Emits `{system_prompt: string, tool_schemas: [...]}`. |
| `--format spec` | Emits the resolved `{agent, flows, ...}` JSON. Same shape a native runner consumes; hand it to spec-aware evaluators. |
| `--language <code>` | Picks the language column of the scripts. Defaults to the first declared language — pass it explicitly for any non-default language, or assertions silently run against the wrong prompt. |
| `--vars-file <path.json>` | Substitutes `{k}` placeholders in the compiled prompt from a JSON key/value file. This is how a runner seeds **pre-context** — typically derived from the bound persona's `vars`. |
| `--vars k=v,k=v` | Same, inline. |
| `--out <path>` | Write to a file instead of stdout. |

### Output of `--format prompt`

```json
{
  "system_prompt": "You're the counter barista at … (the full compiled prompt)",
  "tool_schemas": [
    {
      "name": "place_order",
      "description": "Place the finalized drink order.",
      "parameters": {
        "type": "object",
        "properties": {
          "drink_type": { "type": "string", "enum": ["coffee", "tea"] },
          "drink_style": { "type": "string" },
          "size": { "type": "string", "enum": ["small", "medium", "large"] },
          "milk": { "type": "string", "enum": ["regular", "oat", "almond", "soy", "none"] },
          "syrup": { "type": "string" },
          "honey": { "type": "boolean" }
        },
        "required": ["drink_type", "drink_style", "size", "milk", "syrup", "honey"],
        "additionalProperties": false
      }
    }
  ]
}
```

`tool_schemas` is in the shape Gemini / OpenAI tool-use APIs accept directly. Each capability becomes one tool; the tool `name` is the capability's runtime `name` (e.g. `place_order`), and `parameters.properties` derive from the capability's declared `inputs` and each variable's declared `type` (enums carry their `values`; undeclared types fall back to `string`). For Anthropic, rename `parameters` → `input_schema`.

---

## File shapes you need to know

All carry a `$schema` URI and a stable `id`. flowstore validates them on load. The authoritative TypeBox definitions are in [`packages/core/src/schema/files/`](../packages/core/src/schema/files/).

### `tests/cases/<id>.test.json` — `flowstore://test/case/v0`

Scripted user turns + a bound persona (the world) + which evaluators to run + (optionally) a gold to compare against.

```json
{
  "$schema": "flowstore://test/case/v0",
  "id": "happy-latte",
  "name": "Customer orders a large oat latte and confirms",
  "user_turns": [
    "A latte, please.",
    "Large, oat milk.",
    "Yep, that's it."
  ],
  "assertions": [
    { "turn": 1, "must_contain": ["what can I get"], "must_not_contain": ["card", "total"] }
  ],
  "transcript_assertions": [
    { "kind": "regex", "pattern": "\\{[a-zA-Z_][a-zA-Z0-9_]*\\}", "must_appear": false }
  ],
  "state_assertions": [
    { "variable": "order_status", "equals": "confirmed" }
  ],
  "capability_assertions": [
    { "capability": "cap_place_order", "invoked": true },
    { "capability": "cap_log_walkaway", "invoked": false }
  ],
  "evaluators": ["stayed_on_menu"],
  "gold_id": "happy_latte",
  "persona_id": "regular-customer",
  "model": "gemini-2.5-flash",
  "language": "en-US",
  "tags": ["happy", "src:gold:happy_latte"]
}
```

Fields:

- **`user_turns`** — the agent speaks first when the spec sets `chatbot_initiates: true`; the runner feeds these one at a time, capturing the agent's reply between turns. Mocks (from the bound persona) fire when the agent tool-calls. Omit `user_turns` and bind a persona carrying a `system_prompt` for an LLM-as-user run.
- **`assertions`** — per-turn substring checks. `turn` is **1-indexed into the agent-only subsequence** (turn 1 = the opening). `must_contain` / `must_not_contain`, matched case-insensitively.
- **`transcript_assertions`** — cheap predicates over the whole agent transcript. Four `kind`s: `substring` (present, or `must_appear: false` to forbid), `regex`, `count` (within `min_occurrences` / `max_occurrences`), `must_terminate_within` (ends within `max_turns`). Implemented in your runner; required fields per kind are enforced there, not in the schema.
- **`state_assertions`** — checks against `result.final_variables` (`equals` / `matches` / `is_set`). **Only a native runner that tracks variable scope populates `final_variables`** — against a bare compiled-prompt target these report "needs a native runner" (see [Targets](#targets-and-the-runner-boundary)).
- **`capability_assertions`** — deterministic checks over `result.capability_calls[]`: `{ "capability": "<id>", "invoked": true|false }`. The load-bearing way to pin "placed the order" / "did NOT log a walkaway" without fishing for a mock's return value in prose. `capability` is the capability **id**, not the runtime tool name; `invoked` defaults `true`. These evaluate on **both** targets (the prompt harness dispatches mocks itself and records the calls).
- **`evaluators`** — names. Each resolves to a rubric (`tests/rubrics/<name>.rubric.json`, an LLM judge) if one exists, else a runner-defined evaluator (e.g. a Python module). A bare-bones runner may ship none.
- **`persona_id`** — the bound persona, which supplies the **world** (`vars` + `mocks`). A scripted case binds a *world-only* persona (its `system_prompt` is ignored); a persona-driven case omits `user_turns` and binds a persona whose `system_prompt` drives a simulated user.
- **`gold_id`** — names a `tests/gold/<gold_id>.gold.json`, passed to a gold-comparing rubric as `{gold_standard}`.
- **`model`** / **`language`** — pin the model and language column. `language` is **required** when the spec declares more than one.
- **`max_turns`** — cap on agent turns for persona runs.
- **`tags`** — free-form labels for suite filtering; colon-prefixed namespaces (`src:gold:<id>`, `src:session:<id>`, `src:authored`) are the provenance convention.

A case must carry one of `user_turns` or `persona_id` (enforced in the runner, not the schema).

### `tests/personas/<id>.persona.json` — `flowstore://test/persona/v0`

The **world** a case runs in: seeded `vars`, per-capability `mocks`, and — only for LLM-as-user runs — a `system_prompt`. All optional, so the file type serves two roles.

World-only (bound by a scripted case purely for vars + mocks):

```json
{
  "$schema": "flowstore://test/persona/v0",
  "id": "regular-customer",
  "system_prompt": "",
  "name": "Regular — knows the menu, orders cleanly",
  "vars": { "loyalty_tier": "gold" },
  "mocks": {
    "cap_place_order": { "kind": "static", "returns": { "order_id": "C-2026-0481" } },
    "cap_log_walkaway": { "kind": "static", "returns": {} }
  }
}
```

Driver (its `system_prompt` drives a simulated user):

```json
{
  "$schema": "flowstore://test/persona/v0",
  "id": "indecisive-customer",
  "name": "Can't decide between coffee and tea",
  "system_prompt": "You are a café customer who keeps changing your mind about coffee vs tea before finally ordering a medium tea. Be chatty.",
  "mocks": { "cap_place_order": { "kind": "static", "returns": { "order_id": "C-2026-0482" } } },
  "model": null
}
```

- **`vars`** — a `{name: value}` dict, coerced against the agent's variable declarations at run time. The runner writes it to a temp file and forwards it as `--vars-file`, so the values land as pre-context in the compiled prompt.
- **`mocks`** — `{capability_id: behavior}`. Each behavior is the embedded mock-behavior shape (a sub-object, no `$schema`): `{ "kind": "static", "returns": {...} }` returns its object verbatim every call (`returns` keys mirror the capability's declared outputs); `{ "kind": "error", "error": "..." }` hands the LLM the error string so the agent has to recover. There is no standalone mock *file* and no `variant` — one persona is one world. (Specs with no capabilities, like awaaz, omit `mocks` entirely.)
- **`system_prompt`** — when present, the runner runs it as an LLM-as-user that converses with the agent, up to `max_turns`. Empty/absent = world-only.
- **`model`** — optional per-persona model pin for the simulated user.

### `tests/decisions/<id>.decision.json` — `flowstore://test/decision-test/v0`

Pins one conversational prefix and fans out a matrix of branch inputs to probe a single routing decision cheaply (the prefix is replayed once per branch into a fresh session).

```json
{
  "$schema": "flowstore://test/decision-test/v0",
  "id": "coffee-vs-tea-routing",
  "prefix_turns": ["Hi, I'd like to order something."],
  "branches": [
    { "user_input": "A cappuccino.", "expected_class": "coffee", "must_not_contain": ["tea"] },
    { "user_input": "Green tea, please.", "expected_class": "tea",
      "capability_assertions": [{ "capability": "cap_log_walkaway", "invoked": false }] }
  ],
  "persona_id": "regular-customer",
  "model": "gemini-2.5-flash",
  "language": "en-US"
}
```

The verdict is per-branch `must_contain` / `must_not_contain` plus `capability_assertions` — the latter matter when a routing exit fires a *silent* tool call with no narration. `expected_class` is informational. Binds its world by `persona_id` like a scripted case.

### `tests/rubrics/<id>.rubric.json` — `flowstore://test/rubric/v0`

A declarative LLM-judge criterion. The runner renders `prompt_template` (substituting `{criteria}`, `{transcript}`, and `{gold_standard}` when a `gold_id` was loaded), asks the judge model for a JSON `{score, notes}`, and thresholds on `scale`.

```json
{
  "$schema": "flowstore://test/rubric/v0",
  "id": "stayed_on_menu",
  "name": "Never invented an off-menu item",
  "criteria": "The agent only offered drinks and options that exist on the café menu; it never invented sizes, syrups, or items.",
  "scale": { "min": 1, "max": 5 },
  "prompt_template": "Criterion: {criteria}\n\nTranscript:\n{transcript}\n\nReturn ONLY {\"score\": <int>, \"notes\": \"...\"}.",
  "model": null
}
```

### `tests/gold/<id>.gold.json` — `flowstore://test/gold/v0`

A verbatim reference transcript — the canonical example of how a conversation should go. Independent of cases (one gold may seed many derived cases; a captured gold may have no case yet). See [test-driven-prompts.md](./test-driven-prompts.md) for how golds drive the loop.

```json
{
  "$schema": "flowstore://test/gold/v0",
  "id": "happy_latte",
  "name": "Happy path — large oat latte placed",
  "turns": [
    { "role": "agent", "text": "Morning! What can I get started for you?" },
    { "role": "user", "text": "A latte, please." }
  ]
}
```

### `tests/runs/<timestamp>-<label>/<id>.result.json` — `flowstore://run/result/v0`

**The contract your runner writes.** The editor's result viewer reads exactly this shape.

```json
{
  "$schema": "flowstore://run/result/v0",
  "test_case_id": "happy-latte",
  "timestamp": "2026-05-31T16:45:43Z",
  "model": "gemini-2.5-flash",
  "prompt_source": "flowstore-compile",
  "transcript": [
    { "role": "agent", "content": "Morning! What can I get started for you?" },
    { "role": "user",  "content": "A latte, please." }
  ],
  "capability_calls": [
    { "capability": "cap_place_order", "params": { "drink_type": "coffee", "size": "large", "milk": "oat" },
      "result": { "order_id": "C-2026-0481" }, "timestamp": "2026-05-31T16:45:40Z" }
  ],
  "final_variables": {},
  "evaluator_results": [
    { "name": "assertion.turn1", "passed": true, "notes": "ok" },
    { "name": "stayed_on_menu", "score": 5, "passed": true, "notes": "no off-menu items." }
  ]
}
```

Required: `$schema`, `test_case_id`, `timestamp`, `transcript`.

Optional:

- `agent_id`, `model` — traceability.
- `prompt_source` — `"flowstore-compile"` for the default, or a free-form string (a file path, `"vendor-x-prompt-v2"`) for comparison runs against hand-authored or third-party prompts. Tool schemas always come from the spec; comparison runs vary only the prose.
- `capability_calls` — one per tool call. **`capability` is the stable capability id**, not the runtime name — so evaluators pivot on a stable identifier. Populated on both targets.
- `final_variables` — for `state_check`-style evaluation. **Empty on the compiled-prompt target**; a native runner populates it.
- `evaluator_results` — one entry per assertion and named evaluator. `passed` for boolean checks, `score` for rubrics, `notes` free-form.
- `trials` — for multi-trial runs; each trial mirrors the top-level transcript / calls / results, and the top-level fields hold the last trial.
- `error` — a run that failed outright.

Decision tests write a sibling shape (`<id>.decision-result.json`) with a `branches[]` array instead of a single transcript — a runner output convention distinct from `run/result/v0`.

---

## What a runner must do

The minimal contract: **compile → drive the LLM, dispatching tool calls through the persona's mocks → write a `run/result/v0` file.** Concretely:

1. **Compile** the spec (seeding the bound persona's `vars` as `--vars-file` pre-context). Use `--format prompt` for the compiled-prompt target; `--format spec` if you also feed spec-aware evaluators.
2. **Build the mock dispatcher** from the persona's `mocks` (see below).
3. **Drive the conversation** — feed `user_turns` verbatim, or run the persona's `system_prompt` as an LLM-as-user. Capture each agent reply.
4. **Record capability calls** — translate the runtime tool **name** the LLM returns back to the capability **id** before recording, so `result.capability_calls[].capability` is always the id.
5. **Evaluate** — per-turn `assertions`, `transcript_assertions`, `state_assertions`, `capability_assertions`, and named `evaluators`.
6. **Write** one `run/result/v0` file under `tests/runs/<UTCstamp>-<label>/`.

### Mock dispatch contract

- **Lookup key:** the capability **id**. The bound persona's `mocks` map (`{capability_id: behavior}`) is the whole world — one persona, one behavior per capability, no variants.
- **Static (`kind: "static"`):** return the behavior's `returns` object verbatim every call.
- **Error (`kind: "error"`):** hand the LLM `{error: "<message>"}` as the tool result, so the agent sees a tool error and recovers — this is how you exercise spec branches that route on capability failure.
- **Unbound capability:** a capability the persona's `mocks` doesn't list should return a soft error string into the transcript (the loop keeps going, the gap is visible) rather than crashing the run.

### `capability.id` vs `capability.name`

Each capability declares both:

- **`id`** (e.g. `cap_place_order`) — the stable reference. Persona `mocks` key on it, `capability_assertions` key on it, `result.capability_calls[].capability` is it.
- **`name`** (e.g. `place_order`) — the snake_case runtime dispatch identifier. The compiler emits it in `tool_schemas[].name`, and the LLM returns it when it tool-calls.

Your runner builds the `{name → id}` map from the capability declarations and translates on the way into the result, so everything downstream pivots on the stable id regardless of provider naming quirks.

### Provider notes

The compiler emits the common JSON-Schema convention (`parameters`), which Gemini and OpenAI accept natively.

- **Anthropic** — rename each tool schema's `parameters` → `input_schema`; use `tool_use` / `tool_result` blocks.
- **OpenAI** — wrap as `{type: "function", function: {name, description, parameters}}`; calls come back as `tool_calls[]`.
- **OpenAI-compatible** (vLLM, Ollama, OpenRouter, Together) — same, swap the base URL.

Gemini's function parser additionally rejects some JSON-Schema keys and wants uppercased `type`; the reference runners do a small cleanup pass for it. Your provider may need none of that.

---

## Targets and the runner boundary

The self-contained default target is the **compiled prompt**: a single LLM holds the conversation, your runner dispatches mocks. It exercises conversational behavior and the capability *calls* the model makes — but it does **not** track a variable bag, fire exit-path `actions`, or execute `retrieve_on_turn`. So:

- `state_assertions` always report "needs a native runner" (and `final_variables` stays `{}`).
- Retrieval capabilities (`retrieve_on_turn`) don't pre-fire; the agent answers from what's in the prompt.

That's deliberate. The assertion *shapes* are demonstrated, and the same files run unchanged against a deployed flowstore **runner** — the graph runtime that tracks scope, fires actions, and executes retrieval — where `final_variables` populates and `state_assertions` evaluate normally. `capability_assertions` work on both. awaaz's runner exposes this explicitly via `--target prompt|runner|endpoint`.

---

## Reference runners

| Repo | Driver | Notable |
|---|---|---|
| [flowstore-example-fnol](https://github.com/tap2k/flowstore-example-fnol) | Gemini (Python) | Capabilities + mocks, multilingual (en/es), every test type, gold-comparing rubrics, six vendored Python evaluators. The fullest worked harness. |
| [awaaz-dpd31](https://github.com/tap2k/awaaz-dpd31) | Gemini (Python) | No capabilities (no mocks). Batch suite runner, three run targets, `derive_cases` / `diff_runs` / `make-baseline` tooling, ES-primary. |

Both isolate the provider-specific surface to a small block so you can retarget another LLM, and both invoke this compiler via `FLOWSTORE_COMPILE_CMD`. Read either as a worked reference — not as the only shape.
