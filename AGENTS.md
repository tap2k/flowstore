# Do not keep agent memory for this project

Do not write to the agent memory system for this project. If prior memories exist, ignore them. Persistent guidance, principles, and project context belong in this file (and the related docs listed below), not in per-conversation memory files. When the user tells you something worth remembering across conversations, propose adding it here instead.

# flowstore

Visual editor for flowstore behavioral specs. A Vite-built React SPA that authors, simulates, and exports spec JSON conforming to [SCHEMA.md](./SCHEMA.md).

## Forward direction

**flowstore — a Behavioral IDE for Conversational Agents.** flowstore owns the open, Git-backed development section of the agent pipeline: visual spec authoring, Git-shaped collaboration across stakeholders, structured testing, client sharing. Runtime execution (the Python runner today; Pipecat / LangGraph / etc. post-MVP) and production monitoring (handled by the runtime's event stream and dedicated eval/observability tools like LangSmith, Cekura, Maxim) are separate concerns. flowstore may integrate with production-monitoring tools post-pilot, but those integrations are not in MVP.

The Phase 0 MVP (canvas-first single-file spec editor) shipped 2026-05-08. The organizing vision now is the **flowstore MVP** — GitHub-backed multi-agent projects (one client repo holds N agents like Tala's purpose × language combinations), the spec decomposed into per-concern files with project / agent / flow scope levels ([FILE-MODEL.md](./FILE-MODEL.md)), multi-provider model config, a testing surface that drives compiled system prompts via Python scripts vendored per agent, comments anchored to spec entities, and a static client share view. Target ship: November 2026 for Awaaz pilot; January 2027 for course launch. The staged plan is in [MVP-PLAN.md](./docs/mvp-plan.md); read it before making architectural decisions. The rest of this document describes the current state.

## Product Context

flowstore is the **authoring** surface of the broader flowstore product (browser editor for specs across one or many agents per project). **Testing** happens via Python scripts vendored into each agent's Git repo by `flowstore-init-project` — Nikunj-shaped tooling that compiles the spec to a system prompt + tool schemas and drives an LLM through test cases. Sibling repos:

- `flowstore/` (this repo) — visual editor + `@flowstore/core` libraries (files, schema, codegen, providers). Phase 1 splits this into `@flowstore/core` and `@flowstore/browser` workspaces.
- [`../flowstore-runner/`](../flowstore-runner/) — Python runner; canonical production execution. Interprets the compiled spec artifact, drives voice conversations, emits an event stream. **Untouched in MVP** — testing in MVP doesn't go through the runner. See [`../flowstore-runner/RUNNER-PLAN.md`](../flowstore-runner/RUNNER-PLAN.md).
- **Per-agent or multi-agent Git repos** (customer-owned, flowstore-scaffolded) — hold the decomposed spec(s) under `agents/<id>/` (multi-agent) or at root (single-agent), shared resources at root (capabilities, project-level guardrails, knowledge, personas, evaluators, rubrics), testing artifacts, run history, comments, and Python scripts.

`../whatsupp2/` historically held the evaluation/simulation surface; its responsibilities are being subsumed into flowstore. Treat references to whatsupp2 in older docs as historical.

Runner-based testing and Pipecat compilation are **post-MVP**, gated on [TRANSLATION-POC.md](./docs/translation-poc.md) confirming behavioral fidelity between the system-prompt path and graph-native runtimes. Production monitoring (real-time event stream consumption, dashboards, alerting) is **explicitly out of scope** for flowstore — the runtime emits events; LangSmith / Cekura / Maxim / similar tools consume them.

The schema is the contract across flowstore and the runner. They all defer to [SCHEMA.md](./SCHEMA.md) in this repo.

## Mission

Author a behavioral spec on a **canvas** — a flow graph with nodes for flows and edges for routing (React Flow). The canvas is the primary editor surface. The spec is the product; the canvas is its rendering.

**Sheets** are a secondary surface: tabular editors attached to specific canvas nodes for capturing data that is naturally rectangular — glossary, knowledge base entries, function stubs, and (most importantly) scripts, potentially with translation columns. Sheets are not a standalone view over the whole spec; they hang off the node they belong to.

Narrative sharing with stakeholders is expected to happen *outside* the app for now — e.g., embedding a canvas link inside a Google Doc — rather than by building an in-app doc view. A built-in narrative/doc view is not MVP and may never ship.

### Authoring surfaces

The canvas is the canonical editing surface. Text views are entry and export only — never a live mirror of the spec. Re-importing replaces the current spec; we do not merge text edits back into a live graph. The round-trip fragility that forces tools like Stately into heavy AST machinery is avoided by keeping the canvas canonical.

- **Canvas + inspectors + sheets** — the only place users edit graph structure. Round-trips with the JSON store.
- **Declarative text import** — paste structured input (JSON or YAML matching the schema). Mechanical parse, no LLM. Used both by humans hand-authoring and as the entry point for upstream parsers' output. [AGENT-SPEC-PROMPT.txt](./prompts/AGENT-SPEC-PROMPT.txt) produces v0 JSON the user pastes here.
- **Imperative text import** — paste free-form source: an analyst's script, a process doc, a system prompt, supporting docs. An LLM converts it directly to v0 JSON in one shot, schema-constrained.
- **Export as JSON** — the exported file is the same shape the declarative import accepts; round-trip preserves the spec.
- **Export as system prompt** — deterministic codegen ([packages/core/src/codegen/promptGenerator.ts](./packages/core/src/codegen/promptGenerator.ts)) that flattens the spec into a single monolithic system prompt. For copy-paste into non-runner runtimes (OpenAI, Claude, Voiceflow, etc.); the runner consumes the JSON directly.
- **Simulate panel** — text chat against [`../flowstore-runner/`](../flowstore-runner/), BYOK Gemini, against the spec currently being edited. Canvas highlights the active flow and last-traversed edge live during the run.
- **Eval-on-canvas (post-MVP).** Findings from the testing surface (test cases, mocks, rubrics, run results — all in flowstore per [FILE-MODEL.md](./FILE-MODEL.md)) overlay onto the same node and edge IDs the spec defines — guardrail-fail rates pinned to guardrail nodes, scenario coverage on flow nodes. The canvas is the eval view; there is no separate findings tab.

## Tech Stack

- **Vite 7** (SPA, static build via `vite build`), React 19, TypeScript
- **Tailwind v4** (`@tailwindcss/vite` plugin, no config file)
- **`@xyflow/react`** — canvas
- *(just-in-time)* **`zustand`** — shared editor state, when `useState` gets painful
- *(just-in-time)* **`@sinclair/typebox` + `ajv` + `ajv-formats`** — schema-as-code + runtime validation, when import/export lands
- **localStorage** for autosave; local-first; no server persistence in MVP

Don't add infrastructure before the need. The design doc's MVP discipline is the rule.

- **Routing lives on functions, not edges.** Edges in the canvas are derived from function metadata (`next_node_id` / `decision`), never persisted as standalone entities. Maps cleanly onto our `routing.exit_paths`.
- **Decisions as visualization-helper nodes.** Inline decision nodes render on the canvas but persist as metadata on the parent function, not as separate graph nodes. Keeps the schema clean while giving users the visual they expect.
- **Ajv + TypeBox validation pipeline** (`packages/core/src/validation/`) — two layers: schema validation, then custom graph rules (unique IDs, valid references).
- **Codegen structure** (`packages/core/src/codegen/promptGenerator.ts` today; future targets like Pipecat/LiveKit follow the same pattern) — pure functions that walk the schema and emit a string. No LLM.
- **Schema-driven inspector form pattern** (`packages/browser/src/components/inspector/`) — one form component per schema shape.
- **Local-first persistence** — autosave to `localStorage`, debounced. No server calls. Good model for our MVP.

## Repository Layout

npm workspaces monorepo. `@flowstore/core` is pure TS (files, schema, codegen, providers); `@flowstore/browser` is the Vite-built React SPA. `@flowstore/core` is consumed in-source — Vite reads its TS exports directly, no build step during dev.

```
/package.json                       workspace root; scripts delegate via -w
/tsconfig.base.json                 shared compiler options
/packages/core/                     @flowstore/core (pure TS; no DOM/React/zustand)
  /package.json                     exports map: deep paths + per-subdir barrels
  /scripts/preview-prompt.ts        dev CLI; renders a spec to stdout
  /src/
    index.ts                        re-exports schema/v0 + schema/flowJunction
    ids.ts                          stable-id generation
    /schema/                        TypeBox schema (mirrors SCHEMA.md)
    /codegen/                       export targets (system prompt today; later Pipecat, LiveKit, etc.)
    /validation/                    Ajv validators + graph rules
    /llm/                           provider dispatch + types (providers/google.ts today)
    /runtime/                       conversation-simulation primitives (mocks, persona, transcript, …)
/packages/browser/                  @flowstore/browser (the Vite-built React SPA)
  /package.json
  /vite.config.ts                   @vitejs/plugin-react + @tailwindcss/vite; alias @/* -> ./src/*
  /index.html                       single HTML entry; loads /src/main.tsx
  /src/
    main.tsx                        mounts <App /> via createRoot
    App.tsx                         top-level shell (header, canvas, panels)
    /components/
      /canvas/                      React Flow nodes, edges, controls
      /inspector/                   schema-driven editor forms
      /sheets/                      tabular editors attached to canvas nodes
    /lib/
      /store/                       zustand stores (browser-only state)
      /chat/                        chat-panel store-mutating tools (browser-only)
    /styles/                        globals.css, Tailwind
  /public/                          static assets served as-is (favicon.ico)
/examples/                          demo specs (coffee/, coffee-testing/, fnol/) — loaded via the editor's file picker, not served as runtime URLs
```

To iterate on a codegen target: edit the generator under `packages/core/src/codegen/`, re-run `npm run preview-prompt -- <absolute-path-to-spec>.json`, diff against expected.

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
- **Conversation-shape, not workflow-shape.** flowstore primitives are flows, exit paths, guardrails, captures, three methods. Workflow primitives (if/else nodes, while-loops, transform/map nodes, set-state nodes) are the wrong altitude — that's general-purpose orchestration, not regulated conversational behavior. When extending the schema, push toward the conversation-design vocabulary the buyer already speaks.

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

The end-to-end loop flowstore supports — see [docs/optimization-loop.md](./docs/optimization-loop.md) for the systems view and [MVP-PLAN.md](./docs/mvp-plan.md) for phase timing:

1. **Ingest** — paste a system prompt and attach supporting docs (PDFs, spreadsheets, Word, Figma exports, plain text).
2. **Parse** — a behavioral parser (LLM-assisted) converts inputs to a structured spec. Today this is [AGENT-SPEC-PROMPT.txt](./prompts/AGENT-SPEC-PROMPT.txt). The designer pastes source material in, gets the JSON, and pastes it into the editor's Import. An in-app "Parse with AI" using a user-provided API key is planned to skip the round-trip.
3. **Review and configure** — user reviews the parsed spec on the canvas, edits inline.
4. **Test** — compile spec to system prompt (or graph-native runtime); run test cases through it; diff against assertions and against legacy / baseline prompts. See [docs/test-driven-prompts.md](./docs/test-driven-prompts.md) for methodology, [docs/testing-from-scripts.md](./docs/testing-from-scripts.md) for harness mechanics.
5. **Share** — internal findings report + client-facing shareable document. (Post-MVP flowstore surface.)

## Related Docs in This Repo

- [MVP-PLAN.md](./docs/mvp-plan.md) — organizing vision and staged plan to the flowstore Browser MVP (Nov 2026). Read first.
- [SCHEMA.md](./SCHEMA.md) — authoritative spec data model.
- [FILE-MODEL.md](./FILE-MODEL.md) — how a flowstore project decomposes into files on disk; the serialization contract for SCHEMA.md.
- [TRANSLATIONS.md](./TRANSLATIONS.md) — runtime translation tables (Pipecat, LiveKit, LangGraph, OpenAI Agents SDK; import: Voiceflow, Botpress).
- [docs/optimization-loop.md](./docs/optimization-loop.md) — end-to-end view: client materials → spec + tests → targets → eval, and what would be needed for autonomous optimization.
- [docs/test-driven-prompts.md](./docs/test-driven-prompts.md) — methodology for using the testing harness as a development loop.
- [docs/testing-from-scripts.md](./docs/testing-from-scripts.md) — harness mechanics reference: `flowstore-compile` CLI, file shapes, mock dispatch.
- [AGENT-SPEC-PROMPT.txt](./prompts/AGENT-SPEC-PROMPT.txt) — LLM prompt for converting source material into spec JSON (any frontier LLM).

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
- Match conventions in sibling flowstore repos where reasonable. The spec is the contract; the runner is the canonical native consumer.
- Keep the spec schema evolution discussions in SCHEMA.md. The product vision lives in MVP-PLAN.md.
