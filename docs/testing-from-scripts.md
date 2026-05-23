# Testing UX4 Agents From Scripts

Audience: an engineer who's never seen UX4 and wants to drive their own agent through tests in Python (or anything else). This is the **bring-your-own-script** path — UX4 ships file schemas and a CLI to compile the spec into a usable runtime artifact; how you drive the LLM and evaluate the transcript is up to you.

For the broader project context see [MVP-PLAN.md](../MVP-PLAN.md); for the on-disk layout see [FILE-MODEL.md](../FILE-MODEL.md); for the spec data model see [SCHEMA.md](../SCHEMA.md).

---

## The contract

```
  ┌─────────────────┐                ┌──────────────────────┐
  │  Your spec      │  ux4-compile   │ system_prompt + tools│
  │  (UX4 project)  │ ─────────────▶ │  (JSON)              │
  └─────────────────┘                └──────────┬───────────┘
                                                │
                                                ▼
                                        ┌───────────────┐
                                        │  your script  │
                                        │  drives LLM   │
                                        │  + mocks      │
                                        └───────┬───────┘
                                                │
                                                ▼
                                       ┌────────────────┐
                                       │ result.json    │
                                       │ (UX4 reads it) │
                                       └────────────────┘
```

Three things are load-bearing across the seam:

1. **`ux4-compile`** produces a stable `{system_prompt, tool_schemas}` JSON. Your script drives any LLM with that.
2. **Test cases** (`tests/cases/*.test.json`) define what to run; **personas** (`tests/personas/*.persona.json`) optionally define a user-side system prompt; **mocks** (`capabilities/*.mock.json`) define what capabilities should return during the run.
3. **Result files** (`tests/runs/<timestamp>/*.result.json`) are what your script writes — and what the editor's result viewer reads. The shape is contract.

Everything else (evaluator framework, multi-trial aggregation, gold-standards loading, endpoint mode) is yours to write however you want. The reference scripts UX4 will eventually vendor are *one* shape; not *the* shape.

---

## `ux4-compile` CLI

Invoke from inside this repo (or once installed in your project) as:

```bash
npm -w @ux4/core run ux4-compile -- <project-dir|spec.json> --format prompt
```

Flags:

| Flag | Required? | Notes |
|---|---|---|
| `--format prompt` | yes (or `spec`) | Emits `{system_prompt: string, tool_schemas: [...]}`. Honors `agent.system_prompt_template`. |
| `--format spec` | yes (or `prompt`) | Emits the resolved `{agent, flows}` JSON. Same shape the runner consumes. |
| `--agent <id>` | required in multi-agent projects | Selects which agent to compile. Single-agent projects accept the flag but ignore it. |
| `--out <path>` | no | Writes to file. Default: stdout. |
| `--vars k=v,k=v` | no | Substitutes `{k}` placeholders in the compiled prompt before emit. |
| `--language <code>` | no | For multilingual specs; picks the language column of scripts. Defaults to the first declared language. |

Input may be a project directory (the normal case — UX4 reads `ux4.json` + `agent.json` + `flows/` + the rest per [FILE-MODEL.md](../FILE-MODEL.md)) or a single-file spec JSON (migration / pre-decomposition path).

Output of `--format prompt`:

```json
{
  "system_prompt": "You are Coffee, a friendly barista. ...",
  "tool_schemas": [
    {
      "name": "process_payment",
      "description": "Charges the customer's saved payment method.",
      "parameters": {
        "type": "object",
        "properties": {
          "amount": { "type": "number" },
          "customer_id": { "type": "string" }
        },
        "required": ["amount", "customer_id"],
        "additionalProperties": false
      }
    }
  ]
}
```

`tool_schemas` is in the shape Anthropic / OpenAI tool-use APIs accept (with minor per-provider renaming — see provider docs). Each capability becomes one tool; `parameters.properties` are derived from the capability's declared `inputs` and the agent's `variables[name].type`. Undeclared variables become `string`.

---

## File shapes you need to know

All carry a `$schema` URI and a stable `id`. UX4 validates these on load; the editor refuses to commit invalid files.

### `tests/cases/<id>.test.json` — `UX4://test-case/v0`

A scripted set of user turns + which mocks to use + which evaluators to run.

```json
{
  "$schema": "UX4://test-case/v0",
  "id": "happy-path-large-coffee",
  "name": "Customer orders a large coffee — happy path",
  "user_turns": [
    "I'd like a large coffee please",
    "Just black, thanks",
    "Yes go ahead"
  ],
  "mock_bindings": {
    "process_payment": "success"
  },
  "evaluators": ["forbidden_phrases", "empathy_for_payment_failure"],
  "persona_id": null,
  "model": "claude-sonnet-4-5"
}
```

Fields:

- **`user_turns`** — array of strings. Your script feeds these to the LLM one at a time, capturing the assistant's reply between turns. Mocks fire when the assistant tool-calls.
- **`mock_bindings`** — map of `capability_id` → `variant`. Resolves to `capabilities/<capability_id>.<variant>.mock.json`. An unbound capability call is a hard fail; do not silently default.
- **`evaluators`** — names. Each resolves either to `tests/evaluators/<name>.py` (deterministic Python) or `tests/rubrics/<name>.rubric.json` (LLM-judge). UX4 ships neither yet — you can write your own evaluator framework or skip this for v0 and just write notes into `result.evaluator_results[]`.
- **`persona_id`** — optional. If present, your script loads `tests/personas/<id>.persona.json` and uses its `system_prompt` as the user-side system prompt for LLM-as-user runs (instead of the scripted `user_turns` — your choice of mode).
- **`model`** — optional. Pins this case to a specific model. Resolution chain in [FILE-MODEL.md § Model selection](../FILE-MODEL.md#models-and-providers).

The file's `id` must match the basename (`happy-path-large-coffee.test.json` → `id: "happy-path-large-coffee"`).

### `tests/personas/<id>.persona.json` — `UX4://persona/v0`

A user-side system prompt for LLM-as-user exploration. Minimal by design.

```json
{
  "$schema": "UX4://persona/v0",
  "id": "irritated-frequent-flyer",
  "name": "Irritated frequent flyer",
  "system_prompt": "You are a frequent customer who has had three bad experiences in a row...",
  "notes": "Useful for stress-testing empathy guardrails.",
  "model": null
}
```

### `capabilities/<capability_id>.<variant>.mock.json` — `UX4://capability-mock/v0`

What a mocked capability should return when the agent tool-calls it during a test run.

```json
{
  "$schema": "UX4://capability-mock/v0",
  "capability_id": "process_payment",
  "variant": "success",
  "behavior": {
    "kind": "static",
    "returns": { "transaction_id": "tx-001", "amount_charged": 4.50 }
  }
}
```

Or for the failure case:

```json
{
  "$schema": "UX4://capability-mock/v0",
  "capability_id": "process_payment",
  "variant": "decline",
  "behavior": {
    "kind": "error",
    "error": "Card declined: insufficient funds"
  }
}
```

`kind: "static"` returns its `returns` object verbatim every call. `kind: "error"` raises with the given message. More behavior types (`sequence`, `delay`, etc.) will land when a real spec asks for them.

The filename must match `<capability_id>.<variant>` from the body — UX4 checks this on load.

### `tests/rubrics/<id>.rubric.json` — `UX4://rubric/v0`

Declarative LLM-judge criterion. Your evaluator framework runs the judge model with `prompt_template` (substituting `{transcript}`, `{criteria}`, and optionally `{gold_standard}`) and reads back a score in `scale.min..scale.max`.

```json
{
  "$schema": "UX4://rubric/v0",
  "id": "empathy_for_payment_failure",
  "name": "Empathy when payment fails",
  "criteria": "The agent acknowledges the customer's frustration and offers an alternative.",
  "scale": { "min": 1, "max": 5 },
  "prompt_template": "Rate from {scale.min} to {scale.max} how well the agent met this criterion:\n\nCriteria: {criteria}\n\nTranscript:\n{transcript}\n\nReturn only a number.",
  "model": null
}
```

### `tests/runs/<timestamp>-<label>/<test_case_id>.result.json` — `UX4://result/v0`

**The contract**. Your script writes this. The editor reads it. Field-by-field:

```json
{
  "$schema": "UX4://result/v0",
  "test_case_id": "happy-path-large-coffee",
  "timestamp": "2026-06-15T14:32:11Z",
  "agent_id": "coffee",
  "model": "claude-sonnet-4-5",
  "transcript": [
    { "role": "agent", "content": "Welcome to Cafe! What can I get for you?" },
    { "role": "user",  "content": "I'd like a large coffee please" },
    { "role": "agent", "content": "Great choice! Anything else?" }
  ],
  "capability_calls": [
    {
      "capability": "process_payment",
      "params": { "amount": 4.50, "customer_id": "c-123" },
      "result": { "transaction_id": "tx-001", "amount_charged": 4.50 },
      "timestamp": "2026-06-15T14:32:18Z"
    }
  ],
  "final_variables": {
    "order_total": 4.50,
    "payment_status": "succeeded"
  },
  "evaluator_results": [
    { "name": "forbidden_phrases", "passed": true },
    { "name": "empathy_for_payment_failure", "score": 4.5, "notes": "Judge gave 4-5 across two runs." }
  ]
}
```

Required: `$schema`, `test_case_id`, `timestamp`, `transcript`.

Optional:

- `agent_id`, `model` — for traceability when one project has many agents / multiple models in flight.
- `capability_calls` — needed if you want `tool_calls_check`-style evaluators to work later.
- `final_variables` — needed if you want `state_check`-style evaluation. Tracking a variable scope is your script's job.
- `evaluator_results` — one entry per evaluator that ran. `passed` for boolean checks, `score` for rubrics, both for hybrids. `notes` is free-form.
- `error` — capture failures here so the run viewer renders something useful instead of an empty file.
- `trials` — for multi-trial runs (LLM nondeterminism, pass@k / pass^k aggregation). Each element mirrors the top-level run fields (`transcript`, `capability_calls`, `final_variables`, `evaluator_results`).

Unknown fields are tolerated on transcript turns and capability calls (`additionalProperties: true`); the top-level `Result` object rejects unknown fields so the schema stays the contract.

---

## A minimum `run.py` example

This is one shape. Adapt it. It's deliberately not in the repo — the lesson of [MVP-PLAN.md](../MVP-PLAN.md) is that Nikunj writes the script he needs with Claude Code; UX4 just owns the contract.

```python
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from anthropic import Anthropic

PROJECT = Path("./")
CASE_PATH = Path(sys.argv[1])

# 1. Compile the spec into a system prompt + tool schemas.
compiled = subprocess.check_output(
    ["npm", "-w", "@ux4/core", "run", "ux4-compile", "--",
     str(PROJECT), "--format", "prompt"],
    text=True,
)
compiled = json.loads(compiled)

# 2. Load the test case.
case = json.loads(CASE_PATH.read_text())

# 3. Load mocks once, indexed by capability+variant.
mocks = {}
for p in (PROJECT / "capabilities").glob("*.mock.json"):
    m = json.loads(p.read_text())
    mocks[(m["capability_id"], m["variant"])] = m

def dispatch_mock(name, args):
    # Resolve which mock variant fires for this capability.
    variant = case.get("mock_bindings", {}).get(name)
    if variant is None:
        raise RuntimeError(f"unbound capability: {name}")
    mock = mocks[(name, variant)]
    if mock["behavior"]["kind"] == "error":
        raise RuntimeError(mock["behavior"]["error"])
    return mock["behavior"]["returns"]

# 4. Drive the LLM through user_turns, capturing tool calls.
client = Anthropic()
transcript = []
capability_calls = []
messages = []

for user_turn in case["user_turns"]:
    messages.append({"role": "user", "content": user_turn})
    transcript.append({"role": "user", "content": user_turn})

    while True:
        resp = client.messages.create(
            model=case.get("model", "claude-sonnet-4-5"),
            system=compiled["system_prompt"],
            tools=compiled["tool_schemas"],
            messages=messages,
            max_tokens=1024,
        )
        # Capture any text the assistant produced.
        text_parts = [b.text for b in resp.content if b.type == "text"]
        if text_parts:
            transcript.append({"role": "agent", "content": "\n".join(text_parts)})

        # Dispatch any tool calls. Loop until the assistant stops calling tools.
        tool_uses = [b for b in resp.content if b.type == "tool_use"]
        if not tool_uses:
            messages.append({"role": "assistant", "content": resp.content})
            break

        tool_results = []
        for tu in tool_uses:
            result = dispatch_mock(tu.name, tu.input)
            capability_calls.append({
                "capability": tu.name,
                "params": tu.input,
                "result": result,
            })
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tu.id,
                "content": json.dumps(result),
            })
        messages.append({"role": "assistant", "content": resp.content})
        messages.append({"role": "user", "content": tool_results})

# 5. Write the result file.
out = {
    "$schema": "UX4://result/v0",
    "test_case_id": case["id"],
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "transcript": transcript,
    "capability_calls": capability_calls,
    "evaluator_results": [],  # plug in your own evaluators
}
run_dir = PROJECT / "tests" / "runs" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-manual")
run_dir.mkdir(parents=True, exist_ok=True)
(run_dir / f"{case['id']}.result.json").write_text(json.dumps(out, indent=2))
```

About 90 lines. Add evaluators, multi-trial loops, gold-standard capture, endpoint mode — whatever you actually need. Nothing in UX4 stops you.

---

## Mock dispatch contract

- **Lookup key:** `(capability_id, variant)`. Variant comes from the test case's `mock_bindings` map.
- **Unbound capability:** the agent invoked a capability the test case didn't bind a mock for. Your script should **fail hard** — silently defaulting masks broken tests.
- **Mock failure (`kind: "error"`):** raise with the documented `error` string. The runner sees a tool error, the LLM gets to handle it, and downstream branches in the spec that route on capability failure will exercise correctly.
- **Endpoint mode (when you build it):** `mock_bindings` are ignored — the real endpoint provides the capability. Compare results across mode in the result viewer.

---

## Evaluator placeholder

UX4 ships no evaluator framework today. When you add one:

- Evaluators are referenced by **name** in `test_case.evaluators[]`.
- Names resolve to either `tests/evaluators/<name>.py` (Python module exposing `evaluate(transcript, config, llm_client=None) -> EvaluatorResult`) or `tests/rubrics/<name>.rubric.json` (LLM-judge).
- Results land in `result.evaluator_results[]` with at minimum `name` and either `passed` (boolean) or `score` (number).

Built-in evaluators called out in the [Phase 2 plan](../MVP-PLAN.md#phase-2--testing-surface-mid-august-through-october-2026): `forbidden_phrases`, `required_phrases`, `max_turn_length`, `regex_match`, `state_check`, `tool_calls_check`. None are written yet. Write what you need; we'll converge on a shared library if it earns its keep across customers.

---

## Open questions

Things that aren't pinned yet. Push back if you have strong opinions; we'd rather pin them now than break the contract later.

- **Multi-trial result shape.** `result.trials[]` mirrors the top-level shape. Aggregate metrics (pass@k, pass^k) land on the suite-level run manifest, not the per-case result. Run manifest schema isn't shipped yet.
- **Run manifest** (`tests/runs/<dir>/manifest.json`) — not yet defined. Carries run-level config (which evaluator glob, which model, `--against prompt|endpoint`, trial count) + per-test-case result paths. Schema lands when a real run loop wants it.
- **Rubric template variables.** `{transcript}`, `{criteria}`, `{gold_standard}` are the conventional names; nothing enforces them. Pinning this is a `UX4://rubric/v0` clarification, not a breaking change.
- **Endpoint-mode result shape.** Should an endpoint-mode result note the endpoint URL? Probably yes (for audit), with the URL captured in `run_manifest` not the per-case result. Tabled.
- **Evaluator file format for rubrics + Python.** Python evaluators are flat files; rubrics are JSON. The convention for "this name resolves to a Python file or a JSON file, prefer the Python one if both exist" is documented but not enforced by code yet.

If you hit one of these and need an answer to keep moving, ask. The doc will update; we'd rather have your script working than a perfect spec.
