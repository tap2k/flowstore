# Getting started

A first pass through flowstore's core loop: **author a spec → simulate it → export a system prompt.** Reads in about ten minutes; the worked path runs in two or three.

## Open the editor

The easiest way in is the hosted editor at [flowstore.org/create](https://flowstore.org/create) — nothing to install. It runs entirely in your browser and autosaves to `localStorage`, so your spec survives a refresh; there's no account or server in the loop.

To run it locally instead — for contributing, or working offline:

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5173.

Two of the steps below — the **Assistant** and **Run** (simulate) — call an LLM with your own key. Open **Settings** (gear icon, top right) and paste a key for whichever provider you use: Google, OpenAI, or OpenRouter. Keys live in `localStorage` only. Authoring on the canvas and every export work with no key at all.

## Core concepts

A **spec** is the whole behavioral definition of one agent — a single JSON object. It has two parts: an **agent envelope** and a **graph of flows**. The canvas you author on *is* the graph; everything else hangs off the toolbar.

**The graph**

- **Flows** are the nodes. A flow is a unit of conversational behavior — "greet the caller", "take the order", "confirm and close". Each carries behavioral instructions (prose), optional per-language scripts, and a **type** label: `happy`, `sad`, `off`, `utility`, or `interrupt`. The labels are organizational except `interrupt`, which is structural — an interrupt flow is globally callable, any flow can pivot to it when its entry condition matches. One flow is the **entry flow** where conversations begin.
- **Exit paths** are the edges. Each has a **`condition`** (when this exit is taken) and a **`goto`** destination: another flow's id, `END` (terminate the conversation), or `RETURN` (return to the flow that called this one). A flow that has any `RETURN` exit is *callable* — entering it pushes a call frame. That's the entire routing model; routing lives on the exit paths, never on standalone edges.

**The agent envelope** holds everything outside the graph, reached from the toolbar buttons:

- **Agent** — meta (name, purpose, client, tone, languages) and who speaks first.
- **Guardrails** — global "never / always" statements.
- **Knowledge** — FAQ, glossary, and tables.
- **Capabilities** — the tools the agent can call (functions and retrieval).
- **Variables** — session state. Variables are spontaneous: referencing one anywhere makes it exist. You only declare a variable (in the Variables sheet) when you want to pin a `type` or description onto it.

**Three methods** show up wherever a value is computed or a condition is checked (exit `condition`, entry conditions, assigns): `llm` (semantic judgment), `calculation` (a deterministic Python-like expression over variables), and `direct` (a literal). Keep this in mind when you write exit conditions.

**Export** is deterministic codegen: the spec flattens into one monolithic **system prompt** plus tool schemas. That artifact is what you paste into Claude, OpenAI, or any LLM runtime — and what the simulator runs against.

For the authoritative data model, see [SCHEMA.md](./SCHEMA.md); its "The Model in 30 Seconds" section is the short version of the above.

## Create your first spec

There are four ways in. If you're brand new, start with **the Assistant** (fastest from zero) or **author manually** (best for learning the model). Reach for the source-material path when you already have docs to convert, and the existing-project path once you or your team have a spec in Git.

### 1. Author manually on the canvas

No API key needed, and the most direct way to internalize the model.

1. Add a flow node on the canvas. Select it to open the **flow inspector** — set its name, type, and instructions.
2. Drag from one flow to another to create an **exit path**, then select the edge to open the **edge inspector** and set its `condition` and `goto` (another flow, `END`, or `RETURN`).
3. Fill in the envelope from the toolbar as needed: **Agent** meta, **Guardrails**, **Capabilities**, **Knowledge**, **Variables**.

Validation runs continuously and surfaces inline, so the canvas tells you when a reference dangles or an exit goes nowhere.

### 2. Use the built-in Assistant

Fastest way from an empty canvas. Requires an LLM key (set one in Settings first).

Click the **sparkles** button (top-right of the canvas) to open the Assistant, then describe what you want in plain language. It edits the spec directly through schema-aware tools and re-validates after each change. Try:

- "Create a coffee-ordering agent with greet, order, and confirm flows."
- "Add a guardrail that we never ask for credit card numbers."
- "Split flow_greet into greet + collect_name."

You can also paste an existing system prompt and ask it to build the spec from that. Then refine on the canvas — the Assistant and manual editing operate on the same spec.

### 3. From source material (AGENT-SPEC-PROMPT)

Use this when you already have raw material — an analyst's script, a process doc, an existing system prompt, a spreadsheet — and want a spec from it in one shot.

**In-app (recommended).** Open the Assistant (sparkles button), click **Attach** (or drop files onto the panel) to add your source material, then click **Build from source**. The Assistant runs [`AGENT-SPEC-PROMPT.txt`](./AGENT-SPEC-PROMPT.txt) against your configured model, validates the result against the v0 schema, and loads it onto the canvas — replacing the current spec after a confirm. Attach text files (`.txt`, `.md`, `.json`, `.yaml`, `.csv`, …); for PDF/Word/Figma, copy the text out first. Needs an LLM key in Settings.

**Manual round-trip.** No key in the app, or want to use a model you haven't configured:

1. Open [`AGENT-SPEC-PROMPT.txt`](./AGENT-SPEC-PROMPT.txt). It instructs an LLM to read your material and emit a v0 spec as a single JSON object.
2. Paste that prompt plus your source material into an external LLM (Claude, Gemini, etc.). Copy the JSON it returns.
3. In flowstore, click the **Import** icon, paste the JSON into the box, and choose **Parse & import**. The import is a mechanical, schema-validated parse — no LLM runs in the app — so a malformed object is rejected with errors rather than silently loaded.

The Import path is the *declarative* one: it also accepts hand-written JSON or YAML that matches the schema.

### 4. Open an existing project

For returning to work that already lives in Git or on disk. A brand-new user won't have one yet.

- **From GitHub** — click the GitHub-open (cloud) icon. Add a GitHub PAT in Settings first; then pick a repo and branch. If the branch has no flowstore project yet, the editor offers to initialize a starter one.
- **From a file or folder** — use the **Import** modal's drop zone to drop a `.json`/`.yaml`/`.zip`, or a decomposed project folder.

## Simulate it

With a spec loaded and an LLM key set, click **Run** (top-right of the canvas) to open the **Simulate** panel and chat with your agent. By default this runs in **prompt mode**: the chat goes against the system prompt compiled from the spec you're editing, so you're testing exactly what you'd export.

If you point a **Runner URL** at a paired runtime in Settings, Run drives that runtime instead. Because the runtime emits a routing event stream, the canvas then highlights the active flow and the last exit path taken as the conversation moves — so you watch routing happen live. That live highlighting is a runner-mode feature; prompt mode needs only your LLM key.

## Export

Open the **Export** dropdown:

- **Copy System Prompt** — the compiled prompt on your clipboard, ready to paste into Claude, OpenAI, Voiceflow, or any LLM that takes a system prompt plus tool calls. This is the lowest-friction way to ship.
- **Export JSON** — the full spec as one file. It round-trips: this is exactly what the declarative Import accepts.
- **Export ZIP (decomposed)** — the spec split into the per-concern on-disk file layout. This is the bridge into the Git-backed project and testing world.

## What's next

You've done author → simulate → export. From here:

- [`flowstore-example-fnol`](https://github.com/tap2k/flowstore-example-fnol) — the full worked example: a decomposed multi-flow agent with the complete testing harness (gold transcripts, cases, mocks, rubrics, personas).
- [FILE-MODEL.md](./FILE-MODEL.md) — how a project decomposes into files on disk, single- and multi-agent.
- [SCHEMA.md](./SCHEMA.md) — the authoritative spec data model.
- [AGENTS.md](./AGENTS.md) — architecture, principles, and where flowstore sits in the broader product.
