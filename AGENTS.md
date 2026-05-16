<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know
This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Do not keep agent memory for this project

Do not write to the agent memory system for this project. If prior memories exist, ignore them. Persistent guidance, principles, and project context belong in this file (and the related docs listed below), not in per-conversation memory files. When the user tells you something worth remembering across conversations, propose adding it here instead.

# uxflows

Visual editor for UX4 behavioral specs. A Next.js app that authors, simulates, and exports spec JSON conforming to [SCHEMA.md](./SCHEMA.md).

## Product Context

uxflows is the authoring surface of the broader UX4 product. Three sibling repos compose UX4:

- `uxflows/` (this repo) — visual editor; authors specs.
- [`../uxflows-runner/`](../uxflows-runner/) — Python runner; interprets specs, drives voice conversations, emits an event stream. See [`../uxflows-runner/RUNNER-PLAN.md`](../uxflows-runner/RUNNER-PLAN.md) for the operational plan.
- `../whatsupp2/` — simulation/evaluation app; consumes specs and (eventually) the runner's event stream.

Read these before making non-obvious architectural decisions:

- [`../whatsupp2/AGENT-TESTING.md`](../whatsupp2/AGENT-TESTING.md) — product design doc (v0.9): vision, MVP scope, workflows, schema rationale, strategy, roadmap.
- [`../whatsupp2/AGENT-CLAUDE.md`](../whatsupp2/AGENT-CLAUDE.md) — technical reference for the existing agent-testing implementation in whatsupp2.
- [`../uxflows-runner/RUNNER-PLAN.md`](../uxflows-runner/RUNNER-PLAN.md) — runner v0 plan and rationale (Pipecat-based, Google all-three for v0).

The schema is the contract across all three repos. They all defer to [SCHEMA.md](./SCHEMA.md) in this repo.

## Mission

Author a behavioral spec on a **canvas** — a flow graph with nodes for flows and edges for routing (React Flow). The canvas is the primary editor surface. The spec is the product; the canvas is its rendering.

**Sheets** are a secondary surface: tabular editors attached to specific canvas nodes for capturing data that is naturally rectangular — glossary, knowledge base entries, function stubs, and (most importantly) scripts, potentially with translation columns. Sheets are not a standalone view over the whole spec; they hang off the node they belong to.

Narrative sharing with stakeholders is expected to happen *outside* the app for now — e.g., embedding a canvas link inside a Google Doc — rather than by building an in-app doc view. A built-in narrative/doc view is not MVP and may never ship.

### Authoring surfaces

The canvas is the canonical editing surface. Text views are entry and export only — never a live mirror of the spec. Re-importing replaces the current spec; we do not merge text edits back into a live graph. The round-trip fragility that forces tools like Stately into heavy AST machinery is avoided by keeping the canvas canonical.

- **Canvas + inspectors + sheets** — the only place users edit graph structure. Round-trips with the JSON store.
- **Declarative text import** — paste structured input (JSON or YAML matching the schema). Mechanical parse, no LLM. Used both by humans hand-authoring and as the entry point for upstream parsers' output. [AGENT-SPEC-PROMPT.txt](./AGENT-SPEC-PROMPT.txt) produces v0 JSON the user pastes here.
- **Imperative text import** — paste free-form source: an analyst's script, a process doc, a system prompt, supporting docs. An LLM converts it directly to v0 JSON in one shot, schema-constrained.
- **Export as JSON** — the exported file is the same shape the declarative import accepts; round-trip preserves the spec.
- **Export as system prompt** — deterministic codegen ([lib/codegen/promptGenerator.ts](./lib/codegen/promptGenerator.ts)) that flattens the spec into a single monolithic system prompt. For copy-paste into non-runner runtimes (OpenAI, Claude, Voiceflow, etc.); the runner consumes the JSON directly.
- **Simulate panel** — text chat against [`../uxflows-runner/`](../uxflows-runner/), BYOK Gemini, against the spec currently being edited. Canvas highlights the active flow and last-traversed edge live during the run.
- **Eval-on-canvas (post-MVP).** Findings from the evaluation consumer (currently whatsupp2) overlay onto the same node and edge IDs the spec defines — guardrail-fail rates pinned to guardrail nodes, scenario coverage on flow nodes. The canvas is the eval view; there is no separate findings tab.

## Tech Stack

- **Next.js 16.2** (Pages Router), React 19, TypeScript
- **Tailwind v4** (PostCSS plugin, no config file)
- **ESLint** flat config
- **`@xyflow/react`** — canvas
- *(just-in-time)* **`zustand`** — shared editor state, when `useState` gets painful
- *(just-in-time)* **`@sinclair/typebox` + `ajv` + `ajv-formats`** — schema-as-code + runtime validation, when import/export lands
- **localStorage** for autosave; local-first; no server persistence in MVP

Don't add infrastructure before the need. The design doc's MVP discipline is the rule.

- **Routing lives on functions, not edges.** Edges in the canvas are derived from function metadata (`next_node_id` / `decision`), never persisted as standalone entities. Maps cleanly onto our `routing.exit_paths`.
- **Decisions as visualization-helper nodes.** Inline decision nodes render on the canvas but persist as metadata on the parent function, not as separate graph nodes. Keeps the schema clean while giving users the visual they expect.
- **Ajv + TypeBox validation pipeline** (`lib/validation/`) — two layers: schema validation, then custom graph rules (unique IDs, valid references).
- **Codegen structure** (`lib/codegen/promptGenerator.ts` today; future targets like Pipecat/LiveKit follow the same pattern) — pure functions that walk the schema and emit a string. No LLM.
- **Schema-driven inspector form pattern** (`components/inspector/forms/`) — one form component per schema shape.
- **Local-first persistence** — autosave to `localStorage`, debounced. No server calls. Good model for our MVP.

## Planned Repository Layout

Directional, not prescriptive. Most of this is not built yet.

```
/pages/             Next.js Pages Router entrypoints
  /index.tsx        editor shell
  /api/             API routes (minimal; export/import helpers if needed)
/components/
  /canvas/          React Flow nodes, edges, controls
  /inspector/       schema-driven editor forms
  /sheets/          tabular editors attached to canvas nodes (scripts, glossary, KB, function stubs)
/lib/
  /schema/          TypeBox schema definitions mirroring SCHEMA.md
  /store/           zustand stores
  /validation/      Ajv validators + graph rules
  /codegen/         export targets (system prompt today; later Pipecat, LiveKit, etc.)
                    /__fixtures__/ paired spec.json + expected.txt for snapshot iteration
  /examples/        sample specs for development and "Load Example"
/scripts/           dev-only CLIs (preview-prompt.ts renders a spec to stdout)
/styles/            globals.css, Tailwind
/public/
```

To iterate on a codegen target: edit the generator, re-run `npx tsx scripts/preview-prompt.ts <fixture-or-other-spec>.json`, diff against the saved fixture output.

## Design Principles

From the product design doc. The ones that most affect editor decisions:

- **Schema defines behavior. UI defines rendering.** Node positions, color coding, panel state are UI concerns — not in exported spec JSON.
- **Execution is separate from spec.** Endpoint, headers, model live in a separate `execution` object outside the spec so sharing never leaks credentials. `chatbot_initiates` lives *inside* the spec because it describes behavior.
- **Three methods everywhere.** `llm` / `calculation` / `direct` apply uniformly in captures, conditions, assigns, entry conditions.
- **Symmetric turns.** Agent and user turns share the same structure. Role determines interpretation.
- **The flow is the atom.** Everything is a flow. Authored flows and simulated conversation flows share the same schema.
- **Flows are modular and reusable across agents.** A flow authored for one agent should be droppable into another. Flow-specific data (including translatable scripts) lives inside the flow, not at the agent level. Prefer flow-level schema fields for anything that should travel with a reused flow; agent-level is for things genuinely shared across the whole deployment (plan-level variables, guardrails, glossary). When flows need to interoperate with different callers, use variable mapping (`call`-step `input_mapping` / `output_mapping`) rather than hard-coded variable names or agent-specific enum values in flow routing.
- **Anything referenceable has a stable `id`.** Editor-generated, never authored.
- **Optional by default.** Valid schema with minimal fields. Depth added incrementally.
- **Decomposition is the substrate.** Monolithic prompts hit an instruction-following ceiling in regulated behavior spaces; modular flows are how agents stay reliable at scale.
- **Decomposition is progressive.** Start coarse, split when there's a real seam. The principle above applies *at scale*; for small specs the right move is *less* decomposition. Node count is a result of behavioral seams, not a target.
- **Conversation-shape, not workflow-shape.** UX4 primitives are flows, exit paths, guardrails, captures, three methods. Workflow primitives (if/else nodes, while-loops, transform/map nodes, set-state nodes) are the wrong altitude — that's general-purpose orchestration, not regulated conversational behavior. When extending the schema, push toward the conversation-design vocabulary the buyer already speaks.

## Spec Authoring Granularity

A spec at the right level of detail uses the coarsest level that still captures the seams that matter. Levels:

- **Level 1** — One free-form flow, whole script in `instructions`, no `scripts`. Single coherent conversation, no branching observability needed. The floor: a pasted monolithic prompt enters the spec as this flow's `instructions`, not as an agent-level field.
- **Level 2** — A few flows split where routing actually branches.
- **Level 3** — One flow per agent turn; distinct guardrails or captures per turn.
- **Level 4 (steps)** — One flow with ordered `steps` and per-turn `condition` / `captures`.

A new flow boundary earns its keep when at least one is true:

- **Distinct routing logic** — branches lead to different downstream flows.
- **Observability** — simulation/evaluation needs to assert "did we reach this stage?"
- **Reuse** — the segment is droppable into other agents.
- **Different guardrails** apply than to the surrounding flow.
- **Distinct `type`** — happy / sad / off / utility / interrupt classification differs.

If none of these apply, decomposing is busywork. The canvas makes nodes feel like the "correct" granularity; resist the reflex.

## MVP Scope

From AGENT-TESTING.md — the five-step loop uxflows supports end-to-end:

1. **Ingest** — paste a system prompt and attach supporting docs (PDFs, spreadsheets, Word, Figma exports, plain text).
2. **Parse** — a behavioral parser (LLM-assisted) converts inputs to a structured spec. Today this is [AGENT-SPEC-PROMPT.txt](./AGENT-SPEC-PROMPT.txt). The designer pastes source material in, gets the JSON, and pastes it into the editor's Import. An in-app "Parse with AI" using a user-provided API key is planned to skip the round-trip.
3. **Review and configure** — user reviews the parsed spec on the canvas, edits inline.
4. **Simulate** — run personas against the agent endpoint. Evaluator scores each conversation against guardrails and per-scenario `should_happen` / `should_not_happen`. (in the evaluation consumer, currently whatsupp2)
5. **Share** — internal findings report + client-facing shareable document. (in the evaluation consumer, currently whatsupp2)

## Related Docs in This Repo

- [SCHEMA.md](./SCHEMA.md) — authoritative spec schema
- [MVP-PLAN.md](./MVP-PLAN.md) — ordered work plan to reach MVP, with design decisions and deferred items
- [TRANSLATIONS.md](./TRANSLATIONS.md) — runtime translation tables (Pipecat, LiveKit, LangGraph, OpenAI Agents SDK; import: Voiceflow, Botpress)
- [AGENT-SPEC-PROMPT.txt](./AGENT-SPEC-PROMPT.txt) — LLM prompt for converting source material into spec JSON (any frontier LLM)

## Running

```bash
npm install
npm run dev
```

Opens at http://localhost:3000.

## Style

- Only add comments when the *why* is non-obvious. Never docstring-style multi-paragraph comments.
- Prefer editing existing files over creating new ones.
- Don't add backwards-compat shims. It's early — break freely.
- Match conventions in sibling UX4 repos where reasonable. The spec is the contract; the runner is the canonical native consumer.
- Keep the spec schema evolution discussions in SCHEMA.md. The product vision lives in AGENT-TESTING.md.
