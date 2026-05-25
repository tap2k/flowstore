# coffee-testing — worked example

A complete worked example of the **bring-your-own-script** uxflows testing path. Reads top-to-bottom in about ten minutes. Run end-to-end in about two.

For the full reference docs, see [../../docs/testing-from-scripts.md](../../docs/testing-from-scripts.md).

## What's in here

A uxflows project (the **Bluebird Coffee** ordering agent — decomposed from [`packages/browser/public/coffee.json`](../../packages/browser/public/coffee.json)) plus everything you need to run tests against it:

```
coffee-testing/
├── uxflows.json, agent.json                    ← the spec (decomposed)
├── flows/                                  ← five flows + their scripts.csv files
├── knowledge/                              ← project-scope glossary + a menu table
├── capabilities/                           ← three capability mocks
│   ├── cap_place_order.success.mock.json       happy path
│   ├── cap_place_order.out_of_stock.mock.json  raises "out_of_stock: oat_milk"
│   └── cap_log_walkaway.success.mock.json
├── tests/
│   ├── cases/                              ← three test cases
│   │   ├── happy-path-latte.test.json          customer orders large oat latte, success
│   │   ├── order-fails-out-of-stock.test.json  kitchen is out of oat milk; agent recovers
│   │   └── walkaway.test.json                  customer leaves; agent fires cap_log_walkaway
│   ├── personas/distracted-customer.persona.json
│   └── rubrics/empathy_on_failure.rubric.json  LLM-judge rubric used by case #2
└── scripts/
    ├── run.py                              ← ~150 lines; the contract end-to-end
    └── requirements.txt
```

Every file carries a `$schema` URI; uxflows validates them on load.

## Run it

The example uses **Gemini** (`gemini-2.5-flash` by default) — matches the rest of the project: [BUILT_IN_MODELS](../../packages/core/src/files/models.ts) ships Gemini entries, the editor's Simulate panel is BYOK Google, the runner uses Vertex Gemini. Swap providers in your own script by editing the SDK calls in [`scripts/run.py`](scripts/run.py); the file shapes (`test.json`, `mock.json`, `result.json`) are provider-neutral.

From the **uxflows monorepo root** (so the `npm -w @uxflows/core` workspace resolves):

```bash
# 1. Install Python deps (do this once)
pip install -r examples/coffee-testing/scripts/requirements.txt

# 2. Set your Gemini API key
export GOOGLE_API_KEY=...   # or GEMINI_API_KEY

# 3. Run any of the three test cases
python examples/coffee-testing/scripts/run.py \
  examples/coffee-testing/tests/cases/happy-path-latte.test.json
```

You'll see one line on success:

```
wrote tests/runs/20260523T154500Z-manual/happy-path-latte.result.json
```

Open the result file. It's the same shape as [the result section in the docs](../../docs/testing-from-scripts.md#testsrunstimestamp-labeltest_case_idresultjson--uxflowsresultv0) — what the editor will eventually render.

## Comparing prompts (uxflows vs. hand-authored)

Use case: you have an existing system prompt for the same agent and want to A/B-test it against the uxflows-compiled version. The script supports this with one flag.

```bash
# Default — uxflows compiles agent.json + flows into the system prompt.
python examples/coffee-testing/scripts/run.py \
  examples/coffee-testing/tests/cases/happy-path-latte.test.json \
  --label uxflows

# Same test, your hand-authored prompt — tool schemas still come from the spec.
python examples/coffee-testing/scripts/run.py \
  examples/coffee-testing/tests/cases/happy-path-latte.test.json \
  --system-prompt /path/to/your-prompt.txt \
  --label handauth
```

Diff the two `tests/runs/<ts>-{uxflows,handauth}/happy-path-latte.result.json` files. Same user turns, same mocks, same model, same tools — only the prose varies. Each result records `prompt_source` so you can tell which is which a month later.

If you just want to *eyeball* the compiled prompt without running anything (paste it next to your hand-authored one in Claude.ai):

```bash
npm -w @uxflows/core run --silent uxflows-compile -- \
  examples/coffee-testing --format prompt \
  | jq -r .system_prompt > /tmp/uxflows-coffee.txt
```

## How it works, in one paragraph

`run.py` shells out to `uxflows-compile --format prompt` to get `{system_prompt, tool_schemas}` from the decomposed spec. Then it walks the test case's `user_turns`, calling the Anthropic API with the compiled prompt + tools. When the model invokes a tool, the script looks up `(capability_id, variant)` in the test case's `mock_bindings`, finds the matching `<id>.<variant>.mock.json`, and either returns its `behavior.returns` or raises with `behavior.error`. Every assistant text turn and tool call lands in `transcript[]` / `capability_calls[]`. After the user turns are exhausted (or the inner tool-call budget trips), the script writes a `result.json` matching `uxflows://result/v0`.

That's the entire loop. Evaluators are not run (the `evaluator_results` array is left empty). When you add evaluators, write whatever framework you want — the result file is the only contract.

## What this example is **not**

- **Not a framework.** `run.py` is one script. Yours can look completely different — different LLM provider, different evaluator framework, multi-trial loops, endpoint-mode against a deployed agent, gold-standard capture. Nothing here is canonical except the *file shapes*.
- **Not exhaustive.** Coffee has two capabilities. A real spec might have twenty, retrieval-typed capabilities (you'd handle `kind: retrieval` identically — both are tool calls), or capabilities with declared `outputs` that bind into variable scope (then `final_variables` in the result starts to matter).
- **Not multilingual.** Coffee is `en-US` only. For multi-language specs, pass `--language <code>` to `uxflows-compile`.
- **Not validated against rubrics.** The `empathy_on_failure` rubric is present but unused by `run.py` — adding LLM-judge evaluation is the next step Nikunj writes on his own.

## What to read next

1. [`../../docs/testing-from-scripts.md`](../../docs/testing-from-scripts.md) — the reference: every file shape, the CLI, mock dispatch contract.
2. [`../../FILE-MODEL.md`](../../FILE-MODEL.md) — the on-disk layout. Section [§ Models and providers](../../FILE-MODEL.md#models-and-providers) covers per-test-case `model` pinning.
3. [`../../SCHEMA.md`](../../SCHEMA.md) — the spec data model itself, if you want to understand what `flow_greet` / `int_menu` / etc. are.
