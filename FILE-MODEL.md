# UX4 Project File Model

How a UX4 project is laid out on disk. This is the **serialization contract** for the schema defined in [SCHEMA.md](./SCHEMA.md): the schema defines the data model; this document defines how that model is split across files in a user's GitHub repo.

GitHub is the system of record. A UX4 project is a directory in a Git repo with the layout below. The browser editor reads and writes these files; the Python runner (and other consumers) load them. There is no other persistence layer in the free tier.

For the broader vision this slots into, see [MVP-PLAN.md](./MVP-PLAN.md). For the design principles that govern what lives in the spec vs. outside it, see [AGENTS.md](./AGENTS.md).

---

## Why decompose

A spec is co-authored by people with different concerns:

- **Product / conversation designers** own flows, exit paths, scripts.
- **Legal / compliance** owns guardrails (and often slices of business goals).
- **Ops / domain experts** own knowledge tables and FAQ.
- **QA / eval engineers** own test cases, mocks, rubrics.
- **Translators** own per-language scripts (often non-developers editing in spreadsheets).

Collapsed into one `spec.json`, every change is a diff against the same blob; PR review can't scope to a concern; merge conflicts are guaranteed at any scale; non-developers can't edit anything without round-tripping through a developer. File-level decomposition gives each concern its own diff history, its own owners, and its own editing affordance.

Decomposition isn't dogmatic. Three shapes exist; each entry lives in the shape that fits its editing affordance, not by rule.

---

## The shape rule

**One rule for every collection.** A collection lives as either:

- **File form** — a single `<name>.json` at the canonical path, holding an array or dict of entries.
- **Directory form** — a directory `<name>/` of `*.json` files, each holding one or more entries.

The loader accepts either form transparently — same code path, merged at load. Id collisions across files are an error. The default scaffold picks whichever form fits the typical project size for that collection (see the [Defaults](#defaults-per-collection) table below); a team can collapse to a file or split into a directory at any time without changing anything else.

**Tabular content** (CSV + meta JSON) is a sub-pattern used where data is naturally rectangular and the editing population includes non-developers using spreadsheets — scripts per flow, knowledge tables per id. Tabular collections only support the directory form, because the CSV affordance requires per-file structure. Collapsing them into JSON arrays loses Excel editing.

**Singletons** (`ux4.json`, `agent.json`) are just files — outside the collection rule.

**One exception: `tests/runs/`.** Each run is a folder containing a `manifest.json` plus N result files. Structurally different from "collection of entries"; keep `tests/runs/<timestamp>-<label>/` as-is.

The cut is empirical: how does the human edit this? Small, scan-the-list entries (guardrails, FAQ rows) live happily in the file form; rich, refactored-independently entries (flows, test cases, rubrics) want their own file. The rule supports both either way.

---

## Layout

Default scaffold from `ux4-init-project`. Every collection accepts either form (file or directory) — defaults are listed; alternatives noted in the [Defaults table](#defaults-per-collection).

```
project/
├── README.md                                # user-authored narrative; not loaded
├── ux4.json                                 # project manifest
├── agent.json                               # meta, modes, languages, chatbot_initiates, entry_flow_id
├── models/                                  # default: directory
│   ├── frontier.json                        # claude / gpt / gemini entries via built-in providers
│   ├── self-hosted.json                     # custom provider + its models
│   └── defaults.json                        # { "default": "claude-sonnet-4-5" }
├── guardrails.json                          # default: file (array); → guardrails/<concern>.json to promote
├── business-goals.json                      # default: file (array); → business-goals/<track>.json
├── variables.json                           # default: file (dict); → variables/<domain>.json
├── flows/                                   # default: directory
│   ├── <id>.flow.json                       # instructions, entry_condition, exit_paths, notes, example;
│   │                                        # flow-scoped guardrails / faq / variables inline
│   └── <id>.scripts.csv                     # per-flow utterances; language columns
├── capabilities/                            # default: directory
│   └── <id>.capability.json                 # declaration: kind, inputs, outputs
├── knowledge/
│   ├── faq.json                             # default: file; → knowledge/faq/<topic>.json to promote
│   ├── glossary.json                        # default: file; → knowledge/glossary/<domain>.json
│   └── tables/                              # default: directory (CSV affordance)
│       ├── <id>.csv                         # rows
│       └── <id>.meta.json                   # structure, purpose, scaling_rule
├── tests/                                   # testing artifacts (separate from behavior)
│   ├── cases/<id>.test.json                 # multi-turn scenarios + evaluators
│   ├── mocks/<id>.<variant>.mock.json       # capability behavior for testing
│   ├── rubrics/<id>.rubric.json             # reusable LLM-judge criteria
│   ├── personas/<id>.persona.json           # user-side characters referenced by test cases
│   ├── evaluators/<name>.py                 # Python; built-ins vendored, users add custom
│   ├── gold-standards/<test_case_id>.gold.json  # reference transcripts; promoted from runs/ via --save-as-gold
│   └── runs/<timestamp>-<label>/            # generated; committed when worth keeping
│       ├── manifest.json
│       └── <test-case-id>.result.json
└── scripts/                                 # Python; vendored by ux4-init-project; user adapts with Claude Code
    ├── run_test.py
    ├── run_suite.py
    └── validate.py
```

All `.json` files carry a `$schema` URI under `UX4://...`. All entries carry stable `id`s; the editor generates them, users don't author them.

### Project manifest (`ux4.json`)

```json
{
  "$schema": "UX4://project/v0",
  "name": "string",
  "runtime_targets": ["spec-direct", "system-prompt"]
}
```

Minimal and structural. The canonical directory layout below is the contract — no override map. `runtime_targets` declares which compilation targets the project uses. Two ship in MVP: `spec-direct` (resolved JSON for the runner / simulate panel) and `system-prompt` (compiled monolithic prompt + tool schemas for testing scripts). Pipecat ships post-MVP, gated on [TRANSLATION-POC.md](./TRANSLATION-POC.md). The default model lives in `models/defaults.json`, not here.

### Project README

Every UX4 project gets a `README.md` at root for the user's own narrative — what this agent is for, who owns it, how to run it. Not part of the schema; not loaded by anything. Pure convention, but useful when a stakeholder opens the repo on GitHub.

---

## Defaults per collection

What `ux4-init-project` writes. Every collection accepts either form; the default is the form that fits the typical starting point.

| Collection | Default scaffold | Why this default | When to switch |
|---|---|---|---|
| `flows/` | Directory (per-id `*.flow.json` + paired `*.scripts.csv`) | Almost always more than one flow; each is structurally rich. CSV scripts need the directory form. | Stay in directory form. Collapsing to `flows.json` loses Excel-editable scripts. |
| `capabilities/` | Directory (per-id `*.capability.json`) | Each capability has declared inputs/outputs; refactored independently. | Stay in directory form. |
| `guardrails.json` | File (array) | Typically a short list; reviewed as a set. | Promote to `guardrails/<concern>.json` when stakeholders group by concern (regulatory, safety, tone). |
| `business-goals.json` | File (array) | Typically a short list of outcome criteria. | Promote to `business-goals/<track>.json` when goals span product tracks. |
| `variables.json` | File (dict) | Usually a small dict of declarations. | Promote to `variables/<domain>.json` when variables span domains. |
| `knowledge/faq.json` | File (array) | Starts small. | Promote to `knowledge/faq/<topic>.json` when topics emerge (billing, onboarding, troubleshooting). |
| `knowledge/glossary.json` | File (array) | Usually small. | Promote to `knowledge/glossary/<domain>.json` when terms span fields (financial, legal, product). |
| `knowledge/tables/` | Directory (per-id `*.csv` + `*.meta.json`) | Tabular content needs the CSV affordance. | Stay in directory form. |
| `tests/cases/` | Directory (per-id `*.test.json`) | Each test case is structurally rich (user_turns array + nested evaluators). | Stay in directory form; the file form is technically allowed but unwieldy. |
| `tests/mocks/` | Directory (per-id `*.<variant>.mock.json`) | Multiple variants per capability; each is a behavior spec. Referenced by test cases via mock_bindings. | Stay in directory form. |
| `tests/rubrics/` | Directory (per-id `*.rubric.json`) | Multi-paragraph prompt templates. | Stay in directory form. |
| `tests/personas/` | Directory (per-id `*.persona.json`) | Per-id default for reuse across test cases; tiny projects can collapse. | Collapse if you have ≤3 small personas. |
| `models/` | Directory (`*.json` grouped by tier) | Models grouped by provider tier (frontier, local, custom); built-in providers ship in `@ux4/core`. | Stay in directory form. |
| `tests/evaluators/` | Directory (Python files) | Built-ins (`forbidden_phrases`, `required_phrases`, `max_turn_length`, `regex_match`, `llm_judge`) vendored by `ux4-init-project`; users add `tests/evaluators/<name>.py` following the `evaluate(transcript, config, llm_client=None)` signature. Not validated as JSON artifacts. | n/a |
| `tests/gold-standards/` | Directory (per-test-case `*.gold.json`) | Reference transcripts in the same shape as result files; promoted via `python run_test.py --save-as-gold <case>`. Consumed by the `llm_judge` evaluator when its rubric template references `{gold_standard}`. | n/a |
| `tests/runs/` | Per-run folder | Each run has manifest + N results. **Not part of the shape rule.** | n/a |
| `scripts/` | Directory (Python scripts) | Vendored by `ux4-init-project`; user adapts with Claude Code. Not validated as artifacts. | n/a |

All `.json` files in any collection carry a `$schema` URI under `UX4://...`. All entries carry stable `id`s; the editor generates them.

### Tabular sub-pattern

Two collections use CSV + paired meta JSON:

| File pair | Notes |
|---|---|
| `knowledge/tables/<id>.csv` + `<id>.meta.json` | Rows in CSV; `meta.json` carries structure (field types/descriptions), purpose, and scaling_rule. Loader validates CSV columns against `meta.structure[].field`. |
| `flows/<id>.scripts.csv` | Per-flow utterances. Columns are language codes from `agent.meta.languages`. Variation rows handled via separate columns or an in-cell delimiter convention — pinned during Phase 2 implementation. |

CSV-paired collections only work in the directory form. Collapsing them into JSON arrays (technically allowed) loses Excel editing — a real loss for translators and ops.

### Singletons

| File | Contents |
|---|---|
| `ux4.json` | Project manifest. Minimal and structural. |
| `agent.json` | `meta` (name, purpose, client, tone, languages, modes), `chatbot_initiates`, `entry_flow_id`, top-level `$schema`. The agent envelope **minus** the collections that have moved to their own files. |

### Flow-scoped collections stay inline

`flow.guardrails[]`, `flow.knowledge.faq[]`, and `flow.variables{}` live inside `<id>.flow.json`, not in the global files or directories. They're small, tightly coupled to the flow that owns them, and benefit from physical colocation. Promote to agent-scope when an entry needs to be shared across flows. Global guardrails / faq / variables / etc. are agent-scoped only.

---

## Models and providers

LLM configuration lives in `models/`. Each file is a partial config; the loader merges them all.

```json
// models/frontier.json
{
  "$schema": "UX4://models/v0",
  "models": {
    "claude-sonnet-4-5": { "endpoint": "anthropic", "model_id": "claude-sonnet-4-5" },
    "gpt-5":             { "endpoint": "openai",    "model_id": "gpt-5" },
    "gemini-2.5-pro":    { "endpoint": "google",    "model_id": "gemini-2.5-pro" }
  }
}

// models/self-hosted.json
{
  "$schema": "UX4://models/v0",
  "providers": {
    "my-vllm": {
      "kind": "openai-compatible",
      "base_url_env": "MY_VLLM_URL",
      "base_url_default": "http://localhost:8000/v1",
      "api_key_env": "MY_VLLM_KEY"
    }
  },
  "models": {
    "llama-70b": { "endpoint": "my-vllm", "model_id": "llama3.3:70b" },
    "qwen-72b":  { "endpoint": "my-vllm", "model_id": "qwen2.5:72b" }
  }
}

// models/defaults.json
{
  "$schema": "UX4://models/v0",
  "default": "claude-sonnet-4-5"
}
```

**Endpoint resolution.** Each model's `endpoint` field is a string referencing a named provider — always. Built-in providers (`anthropic`, `openai`, `google`) ship inside `@ux4/core` and are available by name in every project. Custom providers (self-hosted endpoints, vendor proxies) get declared in the `providers` map of any models file before being referenced. One form, one mental model — no inline endpoint objects on model entries.

**Provider kinds.**

- `anthropic` — Claude API; calls Anthropic directly.
- `openai` — OpenAI API; calls OpenAI directly.
- `google` — Gemini API; calls Google directly.
- `openai-compatible` — any host that speaks OpenAI's chat completions API: Ollama, vLLM, OpenRouter, Together, self-hosted proxies. Long-tail catchall.

**Personal variation through env vars.** Anything personal flows through env vars, not through committed config:

- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, custom `*_KEY` per provider — secrets.
- `<base_url_env>` (per provider) — redirect a provider's base URL to your own host.
- `UX4_DEFAULT_MODEL` — override the project default for one shell.
- Per-call `--model` flag on scripts; per-test-case `model` field. Highest precedence.

**Resolution order**, low to high:

1. Built-in providers and models baked into `@ux4/core`.
2. Project `models/*.json` files (merged).
3. Env vars (base URL overrides, default model override).
4. Per-call overrides.

No per-developer config file. Personal endpoints either get added to the committed `models/` (with env-driven URLs so the actual host stays personal) or live entirely in env vars.

---

## References across files

Entries reference each other by stable `id`. The file path is not the contract — the id is.

- `<flow>.exit_paths[].actions[].capability_id` → looks up a `capabilities/<id>.capability.json`.
- `<test-case>.scenario.mock_bindings.<capability_id>` → looks up a `tests/mocks/<capability_id>.<variant>.mock.json`.
- `<test-case>.evaluators[].rubric_id` → looks up `tests/rubrics/<id>.rubric.json`.
- `<test-case>.scenario.persona_id` → looks up `tests/personas/<id>.persona.json` (when present).
- `<flow>.exit_paths[].goto` → flow id, `END`, or `RETURN` (unchanged from SCHEMA.md).
- `agent.entry_flow_id` → flow id; resolves to a file in `flows/`.

The loader (`@ux4/core/files`) builds an id-indexed symbol table on project load. Renaming a file requires the id inside the file to change too; the editor handles this atomically. Validation rejects dangling references.

Path-based references are not used. The directory layout is fixed by the canonical structure above; references in spec content never name a path.

---

## Compiled runtime artifact

The decomposed files are the **source of truth**. Runtimes consume a **compiled artifact** — a single JSON document with the same shape as the historical `spec.json`:

```json
{
  "agent": { ..., "guardrails": [...], "knowledge": {...}, "capabilities": [...], "variables": {...} },
  "flows": [ { ..., "scripts": [...], "guardrails": [...] }, ... ]
}
```

Compilation is mechanical: the loader resolves cross-file references and inlines everything.

**Two compile targets in MVP:**

- **`ux4-compile --target spec-direct`** — produces the resolved JSON document above. This is what the simulate panel hands to the runner, and what the Python runner ingests for production execution. Mechanically the same shape the historical `spec.json` had.
- **`ux4-compile --target system-prompt`** — produces a JSON object `{ system_prompt: <string>, tool_schemas: [<schema>, ...] }` via the existing codegen in [lib/codegen/promptGenerator.ts](./lib/codegen/promptGenerator.ts). This is what Phase 2 testing scripts compile to before driving an LLM through a test case.

Both targets read the same source files. Pipecat compilation is **deferred post-MVP**, gated on [TRANSLATION-POC.md](./TRANSLATION-POC.md) confirming behavioral fidelity.

The Python runner ingests `spec-direct` output. Testing scripts ingest `system-prompt` output. Neither consumes the source files; both go through `ux4-compile`. Clean seam.

Test cases, mocks, rubrics, personas, run outputs, and `models/*` are **not** compiled into the runtime artifact; they live alongside it as the testing and configuration surface.

**Where the compiled artifact lives.** Depends on the consumer. For in-process JS consumers (browser editor's simulate panel using `@ux4/core/compile`), `ux4-compile` produces it in memory. For external consumers (Python testing scripts, archival, debugging), write to disk with `ux4-compile --out <path>`. Conventional path when writing inside the project is `dist/spec.json` or `dist/system-prompt.json`, gitignored by `ux4-init-project`. Compiled artifacts shouldn't usually be committed; treat as the same kind of convention as not committing `node_modules/`.

---

## Schema versioning

Each file's `$schema` field carries the version. The schema doc ([SCHEMA.md](./SCHEMA.md)) is the contract for `agent` and `flow` shapes; this doc is the contract for the file layout itself.

When the file model changes structurally (new collection promoted to its own file, format change, etc.), the project manifest's `$schema` URI bumps. The browser editor and scripts load older versions through a migration pass; the canonical form is always the latest.

Initial version: `UX4://project/v0`.

---

## Migration from single-file specs

Existing specs (the `coffee.json` example, any user file authored against the old single-document shape) are migrated by a one-shot script: `ux4-init-project --from <spec.json>`. It splits the document into the file layout above, writes a default `models/defaults.json`, and scaffolds a `README.md`. The browser editor offers the same migration when a user opens a single-file spec in a UX4 project context.

Backwards compatibility for reading single-file specs is supported in the loader through the MVP — the project manifest's absence is the signal that a directory contains a legacy single-file spec, and the loader handles it transparently. Writing always produces the decomposed layout.

---

## Notes for implementers

- The id-indexed loader is the central component. Build it first in `@ux4/core/files`; everything else (editor, scripts, validation, compilation) depends on it.
- The loader handles the shape rule uniformly: same code path reads `guardrails.json` and `guardrails/*.json`, or `flows.json` and `flows/<id>.flow.json`. One implementation, every collection.
- Validation runs on the in-memory resolved spec, not file-by-file. A single file is valid against its own schema; only the resolved spec is checked against cross-file invariants (referenced ids exist, entry flow is reachable, etc.).
- Commit boundaries should match concern boundaries when possible. Editing a flow and adding a guardrail it references is two changes; commit them separately so the diffs read cleanly.
- The file model is the foundation Phase 1 of [MVP-PLAN.md](./MVP-PLAN.md) builds on. GitHub-backed persistence in Phase 1 reads and writes this layout from day one.
