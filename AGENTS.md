# Do not keep agent memory for this project

Do not write to the agent memory system for this project. If prior memories exist, ignore them. Persistent guidance, principles, and project context belong in this file (and the related docs listed below), not in per-conversation memory files. When the user tells you something worth remembering across conversations, propose adding it here instead.

# flowstore

Visual editor for flowstore behavioral specs. A Vite-built React SPA that authors, simulates, and exports specs conforming to [SCHEMA.md](./SCHEMA.md), read from and written to the markdown source layout in [FILE-MODEL.md](./FILE-MODEL.md).

## Forward direction

**flowstore — a Behavioral IDE for Conversational Agents.** flowstore owns the open, Git-backed development section of the agent pipeline: spec authoring, Git-shaped collaboration across stakeholders, structured testing, client sharing. Runtime execution (a runtime that consumes the compiled spec) and production monitoring (the runtime's event stream, dedicated eval/observability tools) are separate concerns and stay outside.

Since 2026-09-10 flowstore is the **Systems lane** of the Convovo program: the spec as a behavioral program, open source, no business model. Two audiences, two artifacts:

- **The editor (flowstore.org/create)** is the designer and teaching surface — conversation designers authoring flows (client pilots, classroom use, the Conversation Engineering course).
- **The spec + CLI** is the engineering-facing artifact — a portable spec with a public, vendor-neutral compliance-assertion vocabulary, and a CLI any harness (Claude Code included) drives over a project repo: compile, simulate, regress, diff, score, emitting conformance evidence. Engineering shops keep their own authoring and regression; flowstore sits beside their stack as the spec of record, not in place of it.

The current work is the **compliance order (2026-09-11)**: bound compile (spec-hash provenance, shipped 2026-09-12; deploy record next), compliance assertions as a public jurisdiction-tagged vocabulary, one-assertion-one-scenario-one-gold as the pre-deploy battery, a rationale field per instruction, and an exported contract for post-deploy conformance. Design of record: `convovo-notes/flowstore.md`. Backlog and reading order: `~/Desktop/projects/flowstore/planning/TODO.md`.

## Product Context

flowstore is the **authoring** surface of the broader flowstore product (browser editor for specs across one or many agents per project) plus the **CLI** (`flowstore-init-project`, `flowstore-compile`, `flowstore-migrate` in `packages/core`). **Testing** runs against the compiled artifacts: `flowstore-compile --format prompt` / `--format tests` produce the system prompt, tool schemas, and test bundle, and harness scripts vendored into each agent's Git repo drive an LLM through the cases ([docs/testing-from-scripts.md](./docs/testing-from-scripts.md)). Any harness operating the repo (a human, a script, Claude Code) is a first-class user of the CLI. Sibling repos:

- `flowstore/` (this repo) — visual editor + `@flowstore/core` libraries (files, schema, codegen, providers) + `@flowstore/studies` (the compare/regression engine).
- **Per-agent or multi-agent Git repos** (customer-owned, flowstore-scaffolded) — hold the markdown spec(s) under `agents/<id>/` (multi-agent) or at root (single-agent), shared resources at root (capabilities, project-level guardrails, knowledge, personas, evaluators, rubrics), testing artifacts, run history, comments, and harness scripts.
- `flowstore-runner/` (Python graph-native runtime) — **parked since 2026-09-14.** Its loader predates the markdown layout and several schema fields; do not sync it or revive it without an explicit decision.

Production monitoring (real-time event stream consumption, dashboards, alerting) is **explicitly out of scope** for flowstore — the runtime emits events; eval/observability tools consume them.

The schema is the contract across flowstore and any runtime that consumes it. They all defer to [SCHEMA.md](./SCHEMA.md) in this repo. The markdown layout in [FILE-MODEL.md](./FILE-MODEL.md) is the only accepted on-disk form; the pre-markdown layout is refused and its reader lives only behind `flowstore-migrate`.

**Compile provenance (shipped 2026-09-12):** `flowstore-compile --format prompt` emits `provenance` — `spec_hash` over the canonical JSON normal form (never the markdown bytes, so whitespace and key order do not move it), `prompt_hash` over the emitted text, agent id, language, compiler version, time. `--format tests` carries `spec_hash`; `run/result/v0` accepts both. This is the binding between a deployed prompt and the spec it was compiled from; keep it deterministic.

**Schema-change propagation:** a change to spec or testing-artifact schemas must sync the example/customer agent repos (`flowstore-example-fnol` and the private customer agent repos) when the change needs spec edits (e.g. `provided: true` markers on `agent.variables` for vars that should seed at session start) or renames testing-artifact fields (e.g. decision-test `vars` → `state`).

## Mission

Author a behavioral spec on a **canvas** — a flow graph with nodes for flows and edges for routing (React Flow). The canvas is the primary editor surface. The spec is the product; the canvas is its rendering.

**Sheets** are a secondary surface: tabular editors attached to specific canvas nodes for capturing data that is naturally rectangular — glossary, knowledge base entries, function stubs, and (most importantly) scripts, potentially with translation columns. Sheets are not a standalone view over the whole spec; they hang off the node they belong to.

Narrative sharing with stakeholders is expected to happen *outside* the app for now — e.g., embedding a canvas link inside a Google Doc — rather than by building an in-app doc view. A built-in narrative/doc view is not MVP and may never ship.

### Authoring surfaces

The canvas is the canonical editing surface. Text views are entry and export only — never a live mirror of the spec. Re-importing replaces the current spec; we do not merge text edits back into a live graph. The round-trip fragility that forces tools like Stately into heavy AST machinery is avoided by keeping the canvas canonical.

- **Canvas + inspectors + sheets** (flowstore.org/create) — the only place users edit graph structure. Round-trips with the in-memory spec, which saves as markdown files in the [FILE-MODEL.md](./FILE-MODEL.md) layout.
- **Declarative text import** — paste a resolved spec (JSON or YAML matching the schema), or import a project folder or zip in the markdown layout. Mechanical parse, no LLM. [AGENT-SPEC-PROMPT.txt](./AGENT-SPEC-PROMPT.txt) produces the resolved JSON the user pastes here.
- **Imperative text import** — paste free-form source: an analyst's script, a process doc, a system prompt, supporting docs. An LLM converts it directly to v0 JSON in one shot, schema-constrained.
- **Export as JSON** — the exported file is the same shape the declarative import accepts; round-trip preserves the spec.
- **Export as system prompt** — deterministic codegen ([packages/core/src/codegen/promptGenerator.ts](./packages/core/src/codegen/promptGenerator.ts)) that flattens the spec into a single monolithic system prompt. For copy-paste into runtimes that take a system prompt (OpenAI, Claude, Voiceflow, etc.); a graph-native runtime consumes the JSON directly.
- **Simulate panel** — text chat against a paired runtime, BYOK (any configured provider; OpenRouter falls in when a native key is absent), against the spec currently being edited. Canvas highlights the active flow and last-traversed edge live during the run.
- **Compare** (`compare/index.html`, deployed at flowstore.org/compare) — the evaluation entry point: paste a system prompt (run verbatim), edit scenarios, run a small-N model matrix on the user's key. Engine in `@flowstore/studies` (isomorphic; never reads stores); the page is a browser surface sharing the editor's settings store and chrome. Studies export as `.flowstore.json` bundles / GitHub repos the editor opens — git is the graduation bus.
- **Eval-on-canvas (post-MVP).** Findings from the testing surface (test cases, personas, rubrics, run results — all in flowstore per [FILE-MODEL.md](./FILE-MODEL.md)) overlay onto the same node and edge IDs the spec defines — guardrail-fail rates pinned to guardrail nodes, test coverage on flow nodes. The canvas is the eval view; there is no separate findings tab.

## Tech Stack

- **Vite 7** (SPA, static build via `vite build`), React 19, TypeScript
- **Tailwind v4** (`@tailwindcss/vite` plugin, no config file)
- **`@xyflow/react`** — canvas
- **`zustand`** — shared editor state
- **`@radix-ui/react-*`** — behavior primitives under the interactive ui atoms (dialog, dropdown-menu, tooltip, tabs); never imported outside `components/ui/` and `lib/githubUi.tsx`
- **`@phosphor-icons/react`** + self-hosted Geist — icons and type for the design system
- **`@sinclair/typebox` + `ajv` + `ajv-formats`** — schema-as-code + runtime validation
- **localStorage** for autosave; local-first; no server persistence in MVP

Don't add infrastructure before the need. The design doc's MVP discipline is the rule.

- **Routing lives on functions, not edges.** Edges in the canvas are derived from function metadata (`next_node_id` / `decision`), never persisted as standalone entities. Maps cleanly onto our `routing.exit_paths`.
- **Decisions as visualization-helper nodes.** Inline decision nodes render on the canvas but persist as metadata on the parent function, not as separate graph nodes. Keeps the schema clean while giving users the visual they expect.
- **Ajv + TypeBox validation pipeline** (`packages/core/src/validation/`) — two layers: schema validation, then custom graph rules (unique IDs, valid references).
- **Codegen structure** (`packages/core/src/codegen/promptGenerator.ts` today; future targets like Pipecat/LiveKit follow the same pattern) — pure functions that walk the schema and emit a string. No LLM.
- **Schema-driven inspector form pattern** (`packages/browser/src/components/inspector/`) — one form component per schema shape.
- **Local-first persistence** — autosave to `localStorage`, debounced. No server calls. Good model for our MVP.

## Repository Layout

npm workspaces monorepo. `@flowstore/core` is pure TS (files, schema, codegen, providers); `@flowstore/studies` is the isomorphic study engine (matrix runner, bundle read/write, report, voice-cost — depends on core, never on browser); `@flowstore/browser` is the Vite-built React SPA. Core and studies are consumed in-source — Vite reads their TS exports directly, no build step during dev.

```
/package.json                       workspace root; scripts delegate via -w
/tsconfig.base.json                 shared compiler options
/packages/core/                     @flowstore/core (pure TS; no DOM/React/zustand)
  /package.json                     exports map: deep paths + per-subdir barrels
  /scripts/preview-prompt.ts        dev CLI; renders a project (dir or .flowstore.json bundle) to a prompt on stdout
  /src/
    index.ts                        re-exports schema/v0 + schema/flowJunction
    ids.ts                          stable-id generation
    /files/                         markdown source layout: load.ts (parse), decompose.ts (emit), markdown.ts (conventions), legacy.ts (old JSON layout, read-only)
    /schema/                        TypeBox schema (mirrors SCHEMA.md)
    /codegen/                       export targets (system prompt today; later Pipecat, LiveKit, etc.)
    /validation/                    Ajv validators + graph rules
    /llm/                           provider dispatch + types (providers/: google, openai, openai-compatible)
    /runtime/                       conversation-simulation primitives (mocks, persona, transcript, …)
/packages/studies/                  @flowstore/studies (runner, bundle, report, placeholders, voiceCost)
/packages/browser/                  @flowstore/browser (the Vite-built React SPA)
  /package.json
  /vite.config.ts                   @vitejs/plugin-react + @tailwindcss/vite; alias @/* -> ./src/*
  /create/index.html                editor entry; /compare/index.html the second
                                    (path-shaped: the app overlays flowstore.org)
  /src/
    create/main.tsx                        mounts <App /> via createRoot
    App.tsx                         top-level shell (header, canvas, panels)
    /components/
      /canvas/                      React Flow nodes, edges, controls
      /inspector/                   schema-driven editor forms
      /sheets/                      tabular editors attached to canvas nodes
    /compare/                       the compare surface (page, zustand store, studyStorage, GitHub modals)
    /lib/
      /store/                       zustand stores (browser-only state)
      /chat/                        chat-panel store-mutating tools (browser-only)
      githubUi.tsx                  GitHub modal chrome shared by editor + compare
    /styles/                        globals.css, Tailwind
  /public/                          static assets served as-is (favicon, _headers CSP, examples/*.flowstore.json zero-state bundles)
/examples/                          demo specs (coffee/) — loaded via the editor's file picker, not served as runtime URLs
```

To iterate on a codegen target: edit the generator under `packages/core/src/codegen/`, re-run `npm run preview-prompt -- <project-dir-or-bundle.flowstore.json>`, diff against expected. (Bare spec JSON files are no longer accepted as CLI input — use a project directory or bundle.)

## Design system — the two-layer rule

All app chrome is built from the atoms in `packages/browser/src/components/ui/`
and the tokens in `packages/browser/src/styles/tokens.css`. Read
[packages/browser/src/components/ui/README.md](./packages/browser/src/components/ui/README.md)
before touching UI. The short version:

- **Look is ours, behavior is Radix.** Never hand-roll overlay/focus/keyboard
  behavior (focus traps, Escape handling, outside-click dismissal, roving
  tabindex, ARIA bookkeeping). Interactive atoms wrap Radix primitives; a new
  interactive component starts from a Radix primitive too. App code never
  imports Radix directly — it goes through the atoms.
- **Style with tokens only.** `surface-*`, `text-text-*`, `state-*-{fg,line,bg}`,
  `fs-*` type roles, `elev-*`. Raw palette classes (`zinc-*`, `red-600`,
  `bg-white`) in app chrome are a bug. Exception: the canvas graph palette
  (FlowNode/edges + `promptColors.ts` flow tints) is deliberately pinned until
  its dark-mode retrofit.
- **Modals** use the `Dialog` atom, or `Shell` in `lib/githubUi.tsx` for the
  GitHub modals. Menus use `DropdownMenu`. Don't build fixed-overlay divs with
  click-away handlers.
- **Checkbox/Switch stay on native inputs** — the platform primitive is already
  correct there; don't swap them for button-based re-implementations.
- The `/create/?ds` gallery (dev only) renders every atom in both themes — check it in
  light and dark when changing an atom.

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
- **Best mechanism per capability; fallback never override.** When a capability depends on provider features (strict structured output, measured cost, native routing), implement one entry point that picks the best mechanism per provider — and add fallbacks only where the preferred route is *unavailable* (a missing key, an unsupported provider), never silently replacing a route the user picked. Existing instances: model dispatch (native key wins; OpenRouter fallback when it's absent), structured output (strict `responseSchema` on Google/OpenAI; validated chat + corrective retry elsewhere), translate (a thin consumer of the former). Callers never branch on mechanism.
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

## Compliance assertions

The compliance-assertion vocabulary (disclosure at open, self-ID on ask, opt-out honored within N turns, jurisdiction-aware recording notice, mandated read-backs, no PHI in summary, escalation on request) is a **public, vendor-neutral artifact**: first-class `capability_assertions`, jurisdiction-tagged. Requirements come from regulation; the codebook for each assertion is derived from a labeling round, and no codebook is published before one. Receptionist/SMB pilots must not define the vocabulary. One assertion, one scenario, one gold: the persona simulator is the pre-deploy battery. Post-deploy conformance stays outside flowstore; flowstore owes it the exported contract (assertion list, spec hash, golds).

## The core loop

1. **Ingest** — paste a system prompt and attach supporting docs (PDFs, spreadsheets, Word, Figma exports, plain text).
2. **Parse** — a behavioral parser (LLM-assisted) converts inputs to a structured spec, driven by [AGENT-SPEC-PROMPT.txt](./AGENT-SPEC-PROMPT.txt). Two ways to run it: in-app (attach source files in the Assistant and click **Build from source**, which runs that exact prompt against your configured model and loads the validated spec), or the manual round-trip (paste the prompt plus source material into an external LLM, then import what it returns).
3. **Review and configure** — user reviews the parsed spec on the canvas, edits inline.
4. **Test** — compile spec to system prompt; run test cases through it; diff against assertions and against legacy / baseline prompts.
5. **Deploy** — a deploy script in the deploying project (e.g. `deploy-retell` in `mailbot`) pushes the compiled prompt and tools onto the live agent; the deploy record carrying the spec hash is the open item.
6. **Share** — internal findings report + client-facing shareable document. (Post-MVP flowstore surface.)

## Related Docs in This Repo

- [GETTING-STARTED.md](./GETTING-STARTED.md) — first pass through the core loop: author a spec, simulate it, export a system prompt.
- [SCHEMA.md](./SCHEMA.md) — authoritative spec data model.
- [FILE-MODEL.md](./FILE-MODEL.md) — the markdown source layout a project is written in; the serialization contract for SCHEMA.md.
- [AGENT-SPEC-PROMPT.txt](./AGENT-SPEC-PROMPT.txt) — LLM prompt for converting source material into a resolved spec (any frontier LLM); import it and save to get the markdown layout.

## Running

```bash
npm install
npm run dev
```

Opens at http://127.0.0.1:5173.

## Style

- Only add comments when the *why* is non-obvious. Never docstring-style multi-paragraph comments.
- Prefer editing existing files over creating new ones.
- Don't add backwards-compat shims. It's early — break freely.
- Match conventions across the codebase where reasonable. The spec is the contract.
- Keep the spec schema evolution discussions in SCHEMA.md.
