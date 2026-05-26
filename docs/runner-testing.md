# Testing through the runner

Audience: an engineer with a flowstore project repo and a running `flowstore-runner`
who wants to test the runner against the same test cases the system-prompt
path tests against.

Goal: catch divergence between the system-prompt path and the runner path on
the same cases, without changing the cases / mocks / vars files / assertions.
The fidelity gap between the two paths is what MVP testing trades away in
exchange for portability ([MVP-PLAN.md § Critical decisions to verify or make
early](./mvp-plan.md#critical-decisions-to-verify-or-make-early), point 4);
this is how you close it case-by-case when you need to.

For the canonical framework overview (units of testing, current state, plan)
see [testing-plan.md](testing-plan.md). For the system-prompt path see
[testing-from-scripts.md](testing-from-scripts.md); for the methodology see
[test-driven-prompts.md](test-driven-prompts.md); for the systems view see
[optimization-loop.md](optimization-loop.md).

---

## How this differs from `run.py`

```
run.py (system-prompt path)              run_runner.py (runner path)
───────────────────────────              ───────────────────────────
flowstore-compile --format prompt              flowstore-compile --format spec
        ↓                                       ↓
{system_prompt, tool_schemas}            full {agent, flows} JSON
        ↓                                       ↓
genai.Client().generate_content()        POST /api/chat/session
        ↓                                       ↓
loop user_turns                          loop user_turns
  → model reply                            → POST /api/chat/turn
  → translate tool name → id               → events include capability_invoked
  → look up mock                           → runner dispatched the mock for us
  → call again                             → next turn
        ↓                                       ↓
flowstore://result/v0                          flowstore://result/v0
```

Same input files (test case, vars, mocks). Same output schema. Two things
move:

1. **Compile target.** `--format spec` instead of `--format prompt`. The runner
   consumes the resolved graph, not the flattened prompt.
2. **Driver.** HTTP calls to the runner instead of direct LLM calls. The
   runner runs the dispatcher, manages mocks, manages variable scope,
   produces events.

Everything else — `vars_file` substitution into `context_vars`, mock
`(capability_id, variant)` resolution to `(capability_name, returns)`, the
result file shape, assertions — is identical.

---

## Wire protocol summary

What the runner exposes at `/api/chat/`:

| Endpoint | Body | Returns |
|---|---|---|
| `POST /api/chat/session` | `{spec, api_key, model, language, context_vars, mock_returns}` | `{session_id, agent_text, events, ended}` |
| `POST /api/chat/turn` | `{session_id, user_text}` | `{agent_text, events, ended}` |
| `POST /api/chat/end` | `{session_id}` | `{ok}` |

Notes that aren't obvious from the field names:

- **`spec`** is the full resolved spec JSON (output of `flowstore-compile --format
  spec`), not a path. The runner accepts it inline per request — no
  filesystem touch on the runner side.
- **`api_key`** is your Google AI Studio key. If omitted, the runner falls
  back to Vertex via the service account configured at startup. BYOK is the
  right default for cases you run locally.
- **`mock_returns`** keys on capability **name** (snake_case, the runtime
  dispatch identifier), NOT capability **id**. Test cases' `mock_bindings`
  key on id; you translate before sending. Same gotcha as the system-prompt
  path, just in the other direction.
- **`mock_returns`** values are plain dicts of what to return. Mock files'
  `kind: "error"` shape (raise with an error string) isn't currently
  expressible on the wire; raise-style mocks need either a runner extension
  or a follow-up turn that exercises the failure path through other means.
- **`agent_text`** for the opening turn lands in the `session` response when
  `chatbot_initiates: true`. Subsequent agent turns come back from `/turn`.
- **`events`** is the same event stream the canvas highlights against. Use
  `capability_invoked` / `capability_returned` to fill the result file's
  `capability_calls[]`. Use `variable_set` to fill `final_variables`.

---

## Adapting an existing test case — no changes needed

The test case shape is the same:

```json
{
  "$schema": "flowstore://test-case/v0",
  "id": "happy-within-grace",
  "user_turns": ["Hola, bien gracias", "Sí, soy yo", "Sí, puedo pagar mañana sin problema"],
  "assertions": [
    { "turn": 2, "must_contain": ["grabada", "Ana García"] },
    { "turn": 3, "must_contain": ["1100", "buró de crédito"] }
  ],
  "mock_bindings": {},
  "vars_file": "tests/vars.bau.json",
  "model": "gemini-2.5-flash"
}
```

`run_runner.py` reads exactly the same file. The runner does its own
dispatch; assertions still grade the agent's reply text per turn.

---

## What changes in the result file

Same `flowstore://result/v0` shape. Two pivotable fields:

- **`prompt_source`** — set to `"runner"` (or `"runner@<runner-version>"`)
  instead of `"flowstore-compile"`. This is the field the editor's result viewer
  will pivot on when comparing.
- **`final_variables`** — populated from the event stream's `variable_set`
  events, which the system-prompt path can't accurately produce (it has no
  graph executor). Asserting on `final_variables` only works against the
  runner path today.

`capability_calls[]` is populated from `capability_invoked` +
`capability_returned` events; structurally identical to what the
system-prompt path captures from in-loop tool calls.

---

## Run order for an A/B (prompt vs runner)

```bash
# Same test, system-prompt path
python scripts/run.py tests/cases/happy-within-grace.test.json --label prompt

# Same test, runner path (runner must be running locally at $RUNNER_URL)
python scripts/run_runner.py tests/cases/happy-within-grace.test.json --label runner
```

Two run-dirs land side-by-side under `tests/runs/`. Diff:

```bash
diff tests/runs/<ts>-prompt/happy-within-grace.result.json \
     tests/runs/<ts>-runner/happy-within-grace.result.json
```

What divergence looks like and what it means:

- **Different routing decisions** (assertions pass on one path, fail on the
  other) → the system-prompt path's "routing as prose" lost something the
  runner's structural exits enforce. Either the prompt generator needs to
  emit stronger routing guidance, or the spec has a structural seam the
  prose can't capture.
- **Same agent text, different `final_variables`** → variable bindings the
  system-prompt path can't track; runner path is authoritative.
- **Different capability call sequence** → either dispatch ordering (an
  exit_path action that fires on transition vs. a tool call mid-turn) or
  the prompt path skipped a capability it should have called.

---

## Operational notes

- **Runner must be running.** `run_runner.py` doesn't start it. Set up with
  `uvicorn flowstore_runner.server.app:app --reload` from the `flowstore-runner`
  repo, or however you run it for SimulatePanel. Defaults to
  `http://localhost:8000`; override with `--runner-url` or `RUNNER_URL` env
  var.
- **No Python-level coupling to `flowstore-runner`.** `run_runner.py` only
  needs `httpx`. Already in `examples/coffee-testing/scripts/requirements.txt`.
- **`GOOGLE_API_KEY` is forwarded to the runner.** Same BYOK pattern
  SimulatePanel uses. The runner's Vertex fallback also works if you don't
  set one — but for repeatable tests, BYOK is what the rest of the testing
  loop assumes.
- **Mock translation is your script's job.** `mock_bindings` → load the
  paired `<cap_id>.<variant>.mock.json` files → translate `cap_id` → `cap.name`
  via `agent.capabilities[]` → POST `mock_returns` keyed by name. Same
  pattern as the system-prompt path's name-vs-id translation, just done
  before the session starts instead of per-tool-call.

---

## What this doesn't cover

- **Voice testing.** Runner has a voice surface (`/api/offer`); text-mode
  testing is what this doc spans. Voice involves audio infrastructure (VAD,
  TTS quality, prosody) that's a separate problem and out of MVP scope.
- **Raise-style mocks.** `{kind: "error", error: "..."}` mocks aren't on the
  wire today. Workaround: drive a case that exercises the failure path
  through other means (a variable that's already set to the failure
  condition, or a real-but-mocked endpoint returning a 500). Long-term fix
  is a runner extension to `mock_returns` accepting an error payload.
- **Endpoint mode.** The runner can dispatch capabilities through real
  HTTP endpoints in production. Testing against a deployed agent endpoint
  is a separate path — `--against endpoint` mode in the MVP plan
  ([MVP-PLAN.md § Phase 2-E](./mvp-plan.md#phase-2--testing-surface-mid-august-through-october-2026)).
- **Run manifest.** `tests/runs/<dir>/manifest.json` carrying suite-level
  config isn't shipped yet. `run_runner.py` writes per-case `.result.json`
  files; aggregation lives in stdout and your shell pipeline.

---

## Worked example

The worked-example shape: ~150 lines, HTTP-only, drop-in replacement for
`run.py` in any project that already follows the BYO-script pattern. Mirror
the structure of [`examples/coffee-testing/scripts/run.py`](../examples/coffee-testing/scripts/run.py)
— same arg parsing, same `vars_file` handling, same assertion evaluator,
same result-file shape — and swap the per-turn LLM call for a POST to
`/api/chat/turn`.
