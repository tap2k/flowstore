# uxflows MVP plan

Operational plan for the uxflows MVP, derived from discussion on 2026-04-23 and 2026-04-26. High-level principles live in [AGENTS.md](./AGENTS.md); schema contract in [SCHEMA.md](./SCHEMA.md).

## Status (2026-05-08)

All eleven chunks shipped. MVP is complete:

- ✅ 1. Drag nodes + persist positions
- ✅ 2. Spec state management
- ✅ 3. Import / export + autosave + Ajv + TypeBox
- ✅ 4. Flow inspector
- ✅ 5. Scripts sheet (reorder deferred)
- ✅ 6. Edge inspector
- ✅ 7. Agent surfaces (split into toolbar modals, not a single sidebar — see drift note in chunk 7)
- ✅ 8. Add / delete flows + drag-to-connect
- ✅ 9. Basic graph validation
- ✅ 10. Interactive LLM chat (BYOK Google) — shipped 2026-05-02
- ✅ 11. Simulate panel (text chat against the runner) — shipped 2026-05-04

Beyond plan, also shipped: Variables editor (was post-MVP), Tables CRUD (was post-MVP), `entry_flow_id` picker in Agent sheet, delete buttons in inspectors, schema-doc sync, AGENT-SPEC-PROMPT.txt rewritten for one-shot JSON output, Simulate variables form with LLM-powered value generation, system-prompt codegen ([lib/codegen/promptGenerator.ts](./lib/codegen/promptGenerator.ts)), canvas highlight of active flow + last-traversed edge during simulate.

Next up is the post-MVP list below. Top candidates by leverage: ingestion-parser quality (system prompts / transcripts / markdown), deep graph validation (unreachable calculation exits + knowledge-coverage gaps), and the steps editor.

## Goal

Ship an editor that authors a full real-world MVP-scale spec from scratch and exports JSON.

Canvas-first, local-first, single-user.

**Definition of done:**
- Designer starts with nothing, clicks "Load example," sees the sample spec on the canvas with draggable nodes.
- Can click any flow node and edit every field including the `example` transcript; changes persist across reload.
- Can click any edge and edit the exit path (type, condition, next_flow_id, assigns); changes persist.
- Can add a new flow from the toolbar, draw an edge to it, edit its content.
- Can open a flow's scripts sheet and author agent utterances in EN and ES side-by-side.
- Can edit all agent-level collections (Meta, Guardrails, FAQ, Glossary, Tables) via the sidebar.
- Can export a `.json` file that validates against the schema and survives roundtrip through this editor.
- Broken references are caught inline during authoring and at import.

---

## Design decisions

### Editor surfaces

- **Canvas (React Flow)** is the primary editor. Flows as nodes, `routing.exit_paths` as edges.
- **Scripts sheet** is a node-attached tabular editor: rows = utterances, columns = languages. Not a global view over the spec.
- **Agent-level collections** (Guardrails, FAQ, Glossary, Tables, Meta) live in a sidebar; not canvas nodes in MVP.
- **No in-app doc view.** Narrative sharing happens via external Google Doc + canvas link.

### Schema decisions

- **MVP flows use `instructions` + `scripts`**, not structured steps. `instructions` is behavioral prose that compiles into a system prompt fragment. `scripts` is a per-language list of utterances for this flow.
- **Steps are post-MVP.** Turn-level sequencing, per-turn captures, and utterance variations are deferred. MVP authoring via `instructions` + scripts sheet covers the dominant case. The schema does not reserve a placeholder field — when `steps` ships, it enters as a `$schema` version bump.
- **Variables are implicit, optionally enriched.** A variable exists because it is referenced; no upfront declaration required. The schema carries an optional `variables` dictionary at agent and flow level for `type` / `description` — kept tight to what consumers actually need (type info for evaluation and codegen). Scope is determined by runtime value-bucket location, not by a spec field; example values are generated at value-entry time. The schema ships with `variables` in MVP so import/export preserve type info.
- **`flow.example`** — plain-text transcript, annotation-only. Runtimes ignore it; simulation uses it as a seeding hint.
- **`personas` removed from schema.** Persona definitions are out of scope for the spec; they live in the evaluation/simulation consumer (currently whatsupp2).
- **`meta.languages`** — list of language codes. Drives translation table columns on each flow's scripts sheet.
- **User segments removed from spec.** Population context is out of scope for the spec — it lives at project level in the evaluation consumer (currently whatsupp2's `project.stakeholders`), same scope as personas and execution config.
- **Channels** (phone numbers, URLs, emails) are plan-level variables, not capability entries.
- **Interrupt return-bridging** stays as a guardrail. No new typed schema field.
- **`annotations` namespace** planned (post-MVP) for node positions, colors, comments. Runtimes MUST ignore. Two export modes (authoring = includes annotations; runtime = strips them).

### Principles applied (from AGENTS.md)

- Schema defines behavior. UI defines rendering.
- Execution separate from spec.
- Flows are modular and reusable across agents.
- Findings are evidence, not certifications.

---

## Work chunks

Ordered. Each leaves the editor strictly more complete than before.

### 1. Drag nodes + persist positions ✅

- Swap current `useMemo` for `useNodesState` in [components/canvas/Canvas.tsx](./components/canvas/Canvas.tsx).
- `onNodesChange` → debounced localStorage write, keyed by `(specId, flowId)`.
- On mount: load saved positions; fall back to dagre layout for flows without saved positions.
- Positions live in localStorage for MVP. Migration to `annotations.ui.position` post-MVP when round-tripping through export earns its keep.

**Files:** `components/canvas/Canvas.tsx`, new `components/canvas/positions.ts`.

**Drift:** localStorage key is `uxflows:positions:${specId}` — keyed by spec id, not `(specId, flowId)`. The value is a `Record<flowId, {x,y}>` so it functions equivalently.

### 2. Spec state management ✅

- Zustand store holding `spec`, `selection` (`{kind: "flow"|"edge", id: string} | null`), and mutators (`updateFlow`, `updateExitPath`, `addFlow`, `removeFlow`, etc.).
- Store is the single source of truth; canvas and inspector subscribe.
- [pages/index.tsx](./pages/index.tsx) no longer imports the sample spec directly.

**Files:** new `lib/store/spec.ts`, updated `pages/index.tsx`, `components/canvas/Canvas.tsx`.

### 3. Import / export + autosave + Ajv + TypeBox ✅

The editor becomes spec-agnostic at the end of this chunk. Biggest single unit; highest leverage.

- Ship a v0-shaped sample spec at `public/coffee.json` (plain JSON, no TS import).
- **Load example** button fetches `public/coffee.json`, validates, loads into store.
- **Export** serializes store → JSON → file download.
- **Import** reads file-picker or paste-textarea, validates, loads into store.
- **Declarative text import** — second paste-textarea path: schema-shaped outline (YAML/markdown matching the schema) parses mechanically into the same store. One-way; no live mirror. Re-import replaces; confirm if there are unsaved changes.
- **Autosave** on every store mutation (debounced) → localStorage.
- On mount: load from localStorage if present; else empty state with "Load example" / "Import" buttons.
- **TypeBox schema** in `lib/schema/v0.ts` mirroring [SCHEMA.md](./SCHEMA.md) — replaces the hand-written types currently in [lib/types/spec.ts](./lib/types/spec.ts). Single source of truth.
- **Ajv validation** on every import/load; errors listed in a panel; invalid spec is rejected (not partially loaded).

**Files:** new `lib/schema/v0.ts`, `lib/validation/ajv.ts`, `components/toolbar/ImportExport.tsx`, new `public/coffee.json`.

**Drift:**
- "Load example" button removed from the toolbar per design preference — the empty state is just a blank canvas with the toolbar visible. Designer imports a spec or clicks New flow to start.
- Import accepts both JSON and YAML in one modal (drop-zone + paste textarea); the "declarative text" pathway is folded into the same Import modal rather than being a second path.

### 4. Flow inspector ✅

Right-side drawer. Opens when a flow node is selected.

Fields:
- `name`, `description`
- `type` (dropdown: happy | sad | off | utility | interrupt)
- `scope` (visible only when `type === "interrupt"`):
  - Radio: **Global** vs **Scoped to specific flows**
  - When Scoped: multi-select flow picker (chips or checkbox list). Filter out self.
- `instructions` — textarea (behavioral prose)
- `guardrails[]` — list of `{id, statement}` via reusable `ListEditor`
- `example` — textarea (plain-text transcript, free-form)
- `knowledge.faq[]` — flow-scoped FAQ entries; same editor as agent-level FAQ. 
- Button: "Open scripts sheet"

**Files:** new `components/inspector/FlowInspector.tsx`, `components/inspector/ListEditor.tsx`, `components/inspector/FlowPicker.tsx`.

**Drift / additions:**
- Variables editor for flow-scoped variables also shipped here (was post-MVP).
- Entry condition editor exposed for interrupt flows.
- Delete-flow button at the bottom.

### 5. Scripts sheet ✅

- Opens from FlowInspector → modal or expanded panel.
- Rows = script utterances (ordered list from `flow.scripts[lang]`); columns = languages from `agent.meta.languages`.
- Add / delete / reorder rows syncs across all language columns.
- "Add language" button adds a new language column (adds the code to `agent.meta.languages` if not present).
- Cells are plain text inputs; empty cells are valid (partial translation coverage is fine).

**Files:** new `components/sheets/ScriptsSheet.tsx`.

**Drift:** row reorder (up/down arrows) not shipped — add/delete/edit only. Reorder is a watchlist UX item.

### 6. Edge inspector ✅

- Same drawer shell as FlowInspector; switches content when selection is an edge.
- Fields:
  - `type` (dropdown)
  - `condition` — reusable `ConditionEditor` (method + expression)
  - `next_flow_id` — reuses `FlowPicker`
  - `assigns` — simple key-value editor ("add variable assignment")
  - `actions[]` — capability picker that adds `{capability_id}` rows. Picker is populated from `agent.capabilities[]`.
- `ConditionEditor` is the reusable unit — also used by `routing.entry_condition` (interrupt flows).

**Files:** new `components/inspector/EdgeInspector.tsx`, `components/inspector/ConditionEditor.tsx`.

### 7. Agent surfaces ✅

Originally specced as a persistent left sidebar with tabs. Implementation split into separate toolbar buttons opening dedicated modals (Agent / Variables / Guardrails / Capabilities / Knowledge), reusing the existing `SheetShell` modal pattern. Functionally equivalent — every collection has an editor — and the modal-per-concern UX matched the rest of the editor better than a sibling sidebar would have.

- **Agent** modal — `name`, `purpose`, `client`, `languages` (comma-separated), `entry_flow_id` (flow picker), `system_prompt`, `chatbot_initiates`. Agent id displayed inline.
- **Variables** modal — agent-level variable declarations (`type?`, `description?`, `values?` for enums).
- **Guardrails** modal — `ListEditor` of `{id, statement}`.
- **Capabilities** modal — per-entry editor: `name` (snake_case), `description`, `kind` (function/retrieval), `inputs[]`, `outputs[]`.
- **Knowledge** modal — sections for FAQ, Glossary, and Tables. Tables CRUD shipped (was post-MVP): add/remove tables, edit name/purpose/structure/scaling_rule; rows still edit-as-JSON-textarea per the schema's `Record<string, unknown>[]` shape.

**Files:** `components/sheets/{AgentSheet,VariablesSheet,GuardrailsSheet,CapabilitiesSheet,KnowledgeSheet,SheetShell}.tsx`, `components/inspector/primitives.tsx` (shared `Field`/`Section`/`StringListEditor`).

### 8. Add / delete flows + drag-to-connect ✅

- Toolbar **New flow** → creates empty flow with generated id, places at viewport center, focuses inspector.
- Delete key on selected flow or edge → removes from store.
- React Flow `onConnect` → creates a new `exit_path` on the source flow with defaults (`type: "happy"`, `method: "llm"`, empty expression).

**Files:** `components/canvas/Canvas.tsx` (onConnect handler), `components/toolbar/FlowActions.tsx`.

**Drift:**
- New flow + Agent sheet buttons live in `components/toolbar/ImportExport.tsx` rather than a separate `FlowActions.tsx`. Worth renaming the file to `Toolbar.tsx` in cleanup.
- New flow places at dagre-laid-out position (cheap), not viewport-center; user drags as needed.
- Delete buttons also surface in FlowInspector and EdgeInspector with confirm prompts.

### 9. Basic graph validation ✅

- Runs on store mutation (cheap at MVP scale; no debounce needed for MVP).
- Checks shipped:
  - Broken `next_flow_id` references
  - Duplicate flow ids
  - `entry_flow_id` resolves to an existing flow
  - `exit_path.actions[].capability_id` resolves to an existing `agent.capabilities[]` entry
- Surfaces inline: red ring on offending canvas nodes, hover tooltip with reason. Edges with broken capability refs render in red.

**Files:** new `lib/validation/graphRules.ts`; [components/canvas/FlowNode.tsx](./components/canvas/FlowNode.tsx) reads validation status from data.

### 10. Interactive LLM chat (BYOK) ✅ shipped 2026-05-02

Editor-resident chat that authors and edits specs via tool calls. Replaces the previously-deferred one-shot imperative parse.

Why chat over a parse modal: chat tool-calls mutate the same zustand store the inspectors do — the LLM becomes just another UI surface. Consistent with "canvas is canonical" instead of fighting it via text round-tripping. Edit-existing falls out for free since create-new and edit-existing are both sequences of mutator calls against whatever's currently in the store.

**Sub-chunks (ordered):**

- **10a. Settings sheet** — toolbar button → modal with a single Google API key field. **Google (Gemini) only in MVP**; both provider and model are hard-coded in code. Key stored per-browser in localStorage; copy flags BYOK and warns against shared machines. Provider/model selectors land alongside the second provider, not before.
- **10b. Provider dispatch** — `lib/llm/{types,dispatch}.ts` + `lib/llm/providers/google.ts`. Neutral `ChatRequest` / `ChatResponse` shape (system prompt, messages, tools as JSON schema, tool calls round-tripped with provider-issued ids). Only the Google adapter ships, but the dispatch signature takes a `ProviderId` so adding Anthropic/OpenAI later is a new file, not a refactor. Tool-calling mode only; no streaming in MVP.
- **10c. Tool schema** — `lib/llm/tools.ts` exposing existing store mutators (`addFlow`, `updateFlow`, `removeFlow`, `addExitPath`, `updateExitPath`, `removeExitPath`, agent-level edits, scripts edits, etc.) as tools. LLM cannot do anything the user cannot do via inspectors.
- **10d. Chat panel** — right-side panel (or toggleable drawer; final UI shape decided at ship time). Message list, input, tool calls rendered inline so the user sees what mutated. Conversation state per-spec in localStorage, not persisted to spec JSON.
- **10e. System prompt** — seeded from [AGENT-SPEC-PROMPT.txt](./AGENT-SPEC-PROMPT.txt)'s domain content but rewritten for tool-call mode (operate on the current spec, emit tool calls, ask for clarification when ambiguous). Expect this to diverge from the import-oriented prompt over time. Full spec passed as context each turn — cheap at MVP scale.
- **10f. Validation feedback loop** — after each LLM turn with tool calls, run Ajv + graph rules; surface failures back into the conversation so the model can self-correct on the next turn.

**Definition of done (extends top-level DoD):**
- With an empty spec, user describes an agent in chat and sees flows / edges / inspectors populated by LLM tool calls.
- With an existing spec, user asks for incremental edits ("split flow_greet into greet + collect_name", "add a guardrail about credit-card numbers") and they apply via tool calls.
- Invalid tool-call sequences trigger validation errors visible in chat; the LLM recovers on the next turn.

**Watchlist (not blocking MVP):**
- **Chat vs import as separate surfaces.** One-shot import (paste source → spec) and conversational editing are conceptually distinct intents. MVP collapses them into one chat panel; if usage shows the bulk-import case wants its own less-conversational surface, split later.
- **Multi-provider support.** Anthropic and OpenAI adapters, plus the provider/model selector UI, all land together when there's a second provider to justify them. The dispatch signature is provider-keyed from day one so this is additive.
- **Prompt caching.** Gemini caches stable prefixes implicitly — no API work needed as long as we keep `system prompt → tool schema → spec → conversation tail` ordering consistent across turns. Explicit Context Caching API only matters if we later want TTL control or to charge cached tokens to a named handle. Anthropic/OpenAI behave differently; revisit when adding a second provider.
- **Streaming.** Skip for MVP; add if latency feels bad in practice.
- **Context strategy.** Full spec each turn is fine at MVP scale. Switch to selective context when specs get big enough to matter.
- **Richer clarification UI.** Chat may eventually want structured prompts (multi-select pickers, inline diff confirmations) rather than free-text turn-taking. Defer.

**Files:** [`lib/llm/{dispatch,tools,prompts,types}.ts`](./lib/llm/), [`lib/llm/providers/google.ts`](./lib/llm/providers/google.ts), [`components/sheets/SettingsSheet.tsx`](./components/sheets/SettingsSheet.tsx), [`components/chat/ChatPanel.tsx`](./components/chat/ChatPanel.tsx).

**Drift:** chat conversation state lives in [`ChatPanel.tsx`](./components/chat/ChatPanel.tsx) component state rather than the planned `lib/store/chat.ts` — single consumer, no cross-component subscribers, so a store didn't earn its keep.

### 11. Simulate panel (text chat against the runner) ✅ shipped 2026-05-04

Editor-resident text chat against [`../uxflows-runner/`](../uxflows-runner/). BYOK Gemini, localhost runner, request/response per turn. Designer talks to the spec they're authoring without setting up the voice/STT/TTS stack. Canvas highlight (active flow ring + exit-edge pulse) reads from the simulate store directly.

Runner-side contract documented in [`../uxflows-runner/RUNNER-PLAN.md` §"Phase 1.5 — text I/O adapter"](../uxflows-runner/RUNNER-PLAN.md#phase-15--text-io-adapter--shipped-2026-05-04).

**Files:** [`components/runtime/SimulatePanel.tsx`](./components/runtime/SimulatePanel.tsx), [`lib/runtime/textClient.ts`](./lib/runtime/textClient.ts), [`lib/runtime/eventTypes.ts`](./lib/runtime/eventTypes.ts), [`lib/store/simulate.ts`](./lib/store/simulate.ts), with canvas read-out in [`components/canvas/FlowNode.tsx`](./components/canvas/FlowNode.tsx) + [`components/canvas/Canvas.tsx`](./components/canvas/Canvas.tsx).

---

## Post-MVP (deferred, with reasons)

- **Positions migration to `annotations.ui.position`.** Needed for round-trip through export; not blocking single-user editing.
- **`annotations.comments[]` + async comment UI.** Asynchronous collab only.
- **Steps editor** — structured turn sequencing, captures, per-turn conditions, utterance variations. `instructions` + scripts sheet is the MVP authoring surface.
- **Deep graph validation** — variable-reference integrity, `exit_path.assigns` target validity, interrupt-flow `entry_condition` presence. UX target: surface failures inline at edit time on the offending edge or inspector field, not just at import. Two concrete checks surfaced by runner live-testing 2026-04-30:
  - **Unreachable calculation exits.** If an `exit_path.condition` is `method: "calculation"` and reads variable `X`, but no `exit_path.assigns` on any flow reachable from `entry_flow_id` ever produces `X`, the path is dead. Found a real instance in `examples/coffee.json` where `flow_greet`'s coffee/tea exits gated on `drink_type` but nothing set `drink_type` — the conversation deadlocked in flow_greet. Fix is usually changing the exit to `method: "llm"` with a `direct` assign that sets the variable.
  - **Knowledge-coverage gaps that invite confabulation.** When `agent.system_prompt` (or `flow.instructions`) mentions a concept that has no entry in `agent.knowledge.glossary`, no row in `agent.knowledge.tables`, and no capability matching the term, the LLM will invent details at runtime. Coffee.json mentioned "pastries" with no pastry table → LLM cheerfully invented "croissants, muffins, and danishes." Hard to catch perfectly (free text vs. structured knowledge), but a heuristic surfacing nouns in prompts not present in any structured knowledge would catch the obvious cases.
- **Schema additions** — `tool` step (mid-conversation capability dispatch), `call` step (sub-flow invocation), runtime hints. Not in the schema today; arrive as a `$schema` version bump when implementation is ready. Open Questions in [SCHEMA.md](./SCHEMA.md) tracks the design surface. Capability catalog (`agent.capabilities[]`) and post-exit dispatch (`exit_path.actions[]`) are already supported end-to-end.
- **Export as text — multiple formats.** On-demand stringification of the spec for skim, stakeholder share, and code-comfortable authors. Three viable formats as siblings: **declarative YAML** (data-shaped, matches the current import format), **imperative pseudocode** (program-shaped — `flow greet (happy)` / `say` / `capture` / `on ... goto ...`, reads as source code; pairs cleanly with the "spec is a program" framing in [`../whatsupp2/STRATEGY.md`](../whatsupp2/STRATEGY.md)), and **markdown narrative** (prose-shaped, for embedding in Google Docs / stakeholder review). Read-only by default; if any becomes bidirectional, it replaces canvas state on re-import — never merge ([AGENTS.md](./AGENTS.md) explicitly avoids the round-trip-fragility trap). Cheap one-way; bidirectional earns its keep only if a customer wants imperative as their primary authoring surface.
- **Id rename with cascade update.** Routing-plumbing ids (`flow.id`, `exit_path.id`, `script_line.id`, `guardrail.id`, `business_goal.id`, `capability.id`-as-editor-handle, etc.) are immutable in MVP; delete-and-recreate to change. The runner walks them deterministically and the LLM never sees them — so the cosmetic value of renaming is low until eval data starts pinning to them. LLM-facing identifiers (`capability.name`, variable names, glossary `term`, FAQ `question`, guardrail `statement`) are already author-controlled and freely editable today.
- **Vertical templates.** Banking collections, healthcare intake, insurance claims, etc. Templates are regular specs — the cold-start UX is "load template → edit," same plumbing as the existing example loader. No template-specific schema fields.
- **Skip dagre re-layout when topology hasn't changed.** Today every spec mutation (including each keystroke in any inspector field) re-runs `buildGraph` + `dagre.layout` + `setNodes`/`setEdges` in [Canvas.tsx](./components/canvas/Canvas.tsx). Fine at MVP scale; will lag at 100+ flows. Surgical fix: re-layout only when flow ids or edge connectivity changes; for pure data updates (name, instructions, condition text), update node `data` in place, keep positions. Preserves live-preview while killing the hot-path cost.
- **Generate-example-transcript button.** One-shot "show me a plausible run of this flow" affordance — LLM samples a transcript from the spec, renders it inline for skim/share. Useful for stakeholder walkthroughs without standing up a runner. Today the SimulatePanel covers the live case; this is the static / paste-into-a-doc variant.
- **Versioning of specs and guardrails.** Specs and the guardrails they import need shared version semantics; treating them separately is wrong. Today the only persistence is whatsupp2's `runs.config_snapshot`, which freezes the spec at run time as a side-effect, not as authored history. A complete answer requires a storage decision that pulls against the browser-contained authoring posture: server-side history gives team-grade versioning and weakens the on-prem pitch; client-side history preserves the pitch and fails for teams; schema-only version fields are portable but leave users managing versioned files by hand. Pick when a customer forces it — likely when multi-author editing or a banking audit trail becomes load-bearing. Until then, the run snapshot is the de-facto record.

---

## Risks

- **Scripts sheet UX needs care.** Row ordering must stay consistent across language columns. Empty cells (partial translation coverage) must be handled gracefully.
- **Inspector grows fast.** ListEditor, ConditionEditor, FlowPicker — build the primitives first or it becomes a bespoke mess.
- **Validation timing.** Ajv on every keystroke is wasteful; on-export-only misses authoring feedback. Debounced at ~300ms.
- **LLM-parsed specs are noisy.** Schema validation at import is load-bearing — half-valid specs cascading into the store are confusing. Reject hard, surface errors clearly.
