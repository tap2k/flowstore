# flowstore Project File Model

How a flowstore project is laid out on disk. This is the serialization contract for the data model in [SCHEMA.md](./SCHEMA.md): the schema defines the entities; this document defines the files they are written in and read from.

Git is the system of record. A project is a directory in a repo. The editor, the CLI, and the harnesses all read and write these files; there is no other persistence layer.

## The model in one paragraph

The source is markdown. Each file is YAML frontmatter followed by a markdown body. The body is what the model reads: instructions, guardrails, scripts, FAQ answers, capability descriptions. The frontmatter is what the machine reads: ids, flow types, exit paths and their conditions, assigns, actions, capability signatures. Collections with no model-facing text at all (variables, business goals, models) are plain YAML. The parser turns a project into the resolved JSON spec in [SCHEMA.md](./SCHEMA.md); the compiler, simulator, runner, canvas, and validator consume that JSON and never see the markdown. Nobody hand-edits the JSON.

## Layout

```
project/
├── README.md                    yours; written once by init, never touched on save
├── flowstore.yaml               manifest: { $schema: flowstore://spec/project/v1 }
├── agent.md                     envelope in frontmatter; body = system_prompt (optional)
├── guardrails.md                one guardrail per line: "- id: statement"
├── business-goals.yaml          list of { id, name, expression, method }
├── variables.yaml               { name: { type, description, values, provided, visible_when } }
├── capabilities/<id>.md         frontmatter = name, kind, inputs, outputs, flags; body = description
├── knowledge/
│   ├── faq.md                   "### id: question" then the answer
│   ├── glossary.md              "### id: term" then the definition
│   └── tables/<id>.md           frontmatter = name, notes, structure, scaling_rule; body = pipe table
├── flows/<id>.md                one flow per file (below)
├── models/models.yaml           model catalog and roles
├── comments/<uuid>.comment.json anchored review threads; editor-written
└── tests/                       cases, personas, rubrics, golds (markdown); decisions (YAML); evaluators; runs
```

Every collection accepts a file form or a directory form. `guardrails.md` and `guardrails/<concern>.md` are the same collection; so are `knowledge/faq.md` and `knowledge/faq/<topic>.md`, and `variables.yaml` and `variables/<domain>.yaml`. Entries concatenate in path order; a duplicate id is an error.

Ids are never derived from text. A per-file entity takes its id from the filename. An entity inside a file carries its id explicitly: a `### id` heading, or a leading `- id:` on a list line. The parser refuses to invent one.

## A flow file

```markdown
---
type: happy
exit_paths:
  - id: xp_no_credentials
    goto: no_credentials
    condition: applicant does not have the GST portal username or password
  - id: xp_failed_thrice
    goto: escalate_to_team
    condition: username rejected three times
    assigns:
      callback_reason: { method: direct, value: GST credentials rejected after three attempts }
    actions: [cap_book_callback]
---
# GST portal username and flow split

Ask the applicant to enter, below their GST number, their GST portal username...

## Scripts

### s_ask_username
Below your GST number, please enter your GST portal username.

### s_filler
It's processing — usually a minute or two.
- EN: Fetching your GST filings securely.
- EN: Almost there — don't refresh.

## Guardrails
- g_flow_split_is_state: Never assume which screen the applicant is on from elapsed time.

## FAQ
### faq_why_username: Why do you need my GST username?
The credit line is calculated from your GST filings.

## Example
Agent: ...
User: ...

## Notes
Authoring annotation. Never compiled.
```

- The `# ` heading is the flow's name. Everything between it and the first `## ` section is the instructions.
- Frontmatter holds every other schema field: `type`, `entry_condition`, `exit_paths`, `variables`, `retrieve_on_turn`, `tools`, `model_role`, `version`.
- Two shorthands: a bare string `condition` means `{ expression, method: llm }`, and an `actions` list of capability ids means `[{ capability_id }]`. The long forms are accepted too; only `llm` conditions collapse to a string.
- The sections are `Scripts`, `Guardrails`, `FAQ`, `Example`, `Notes`. Anything else is an error.

## Localized text

A `LocalizedString` (script text, FAQ answer, pending message) is written one of two ways, and the two round-trip exactly:

- A plain string is a paragraph.
- A per-language map is `- <lang>: text` lines, one per language, using the codes declared in `agent.md`. A second line for the same language is a variation. A line continues onto the next line when that line is indented two spaces.

Under a script heading, a paragraph followed by language lines means: the paragraph is the text, every line is a variation. Language lines alone mean: the first line per language is the text, later ones are variations. A list line whose key is not a declared language code is ordinary text.

## agent.md

```markdown
---
id: agent_pice_gst_connect_recovery
name: pice-gst-connect-recovery
identity: Priya from Pice Capital
purpose: Call applicants who stopped at the GST step and walk them through it.
tone: helpful, direct, calm
modality: voice
languages: [EN]
chatbot_initiates: true
entry_flow_id: opening
---
```

The `meta` fields are flattened into the frontmatter. The body, when present, is `system_prompt`: a `{{generated}}` template or a verbatim override, as in [SCHEMA.md](./SCHEMA.md#agent-schema). An imported prompt-only agent is `agent.md` with that body and no flows.

## Translators

Scripts live in the flow files. A translator gets a spreadsheet through the editor's scripts sheet export, edits the language columns, and imports it back; the CSV is an interchange format, not a source file.

## Testing artifacts

Prose-bearing artifacts are markdown with frontmatter; the body holds the artifact's own prose.

| File | Frontmatter | Body |
|---|---|---|
| `tests/cases/<id>.md` | everything typed: vars, mocks, assertions, evaluators, persona_id, language, tags | notes as the preamble; `## Turns`, the user side of a transcript in the grammar below; `## Actor` for an inline user-sim prompt |
| `tests/personas/<id>.md` | vars, mocks, traits, model, tags | the system prompt as the preamble; `## Notes` |
| `tests/rubrics/<id>.md` | scale, model | the criteria as the preamble; `## Prompt template` |
| `tests/gold/<id>.md` | vars, mocks, language, blessed_at, tags, source_pointer | notes as the preamble; `## Transcript` of `Agent:` / `User:` lines, a continuation line indented two spaces |
| `tests/decisions/<id>.yaml` | the whole routing matrix | none |

One line grammar serves a gold's transcript, a case's turns, and the compare tool's scenario editor: `User: text` or `Agent: text` starts a turn, `User [barge-in]: text` marks an interruption, an empty `User:` is a silent turn, and any other non-blank line continues the turn before it. A case is a gold with only the user side; a transcript pastes between a project file and compare unchanged.

`tests/evaluators/*.py` are Python. `tests/runs/<timestamp>-<label>/` holds a manifest and one `*.result.json` per case, gitignored.

## Models

`models/models.yaml` holds the model catalog and the roles (`default`, `roles.judge`, `roles.user_simulation`, ...). The loader merges every `models/*.yaml` in path order, so a repo may split the catalog from the defaults; the editor writes the merged config back to `models.yaml`.

## Compiled artifact

`flowstore-compile --format spec <dir>` emits the resolved JSON spec; `--format prompt` emits `{ system_prompt, tool_schemas, provenance }`, where `provenance` carries `spec_hash` (SHA-256 of the spec's canonical JSON normal form, keys sorted, first 16 hex; never of the markdown bytes, so a whitespace or key-order edit does not change it and a content edit does) and `prompt_hash` (of the emitted prompt), plus `agent_id`, `compiled_at`, and the compiler version; a runtime logs the pair per call and a run result carries it; `--format tests` emits `{ cases, personas, rubrics, golds, decisions, models }`. A harness reads those and never parses source files. Compiled output goes to `dist/`, gitignored.

## Migration

A project in the pre-markdown JSON layout (`agent.json`, `*.flow.json`, `*.scripts.csv`, `*.test.json` and the other JSON test files, `models/*.json`) does not load. The loader says so and names the fix: `flowstore-migrate <project-dir>` converts it in place, then reloads the result and refuses to finish if any entity differs from the original. A markdown project with old files left beside it is refused the same way, listing them. The old layout is read by nothing else.

## The spec prompt

`AGENT-SPEC-PROMPT.txt` asks an LLM to emit a project as one text document of files, each introduced by a `--- file: <path> ---` line. The editor's build-from-source and its import paste both accept that document; `parseFileBundleText` in core turns it into files and `loadProject` validates them.

## Non-loaded files

Anything outside the paths above is ignored: `docs/`, `assets/`, `scripts/`, CI config. They ride along in the repo; the README is the place to inventory them.
