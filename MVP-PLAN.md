# uxflows MVP plan

Operational plan for the uxflows MVP. Architectural rationale stays in [AGENTS.md](./AGENTS.md); schema contract in [SCHEMA.md](./SCHEMA.md).

## Status (2026-05-08)

All eleven chunks shipped. MVP is complete.

- ✅ 1. Drag nodes + persist positions
- ✅ 2. Spec state management (zustand)
- ✅ 3. Import / export + autosave + Ajv + TypeBox
- ✅ 4. Flow inspector
- ✅ 5. Scripts sheet (row reorder deferred — see Beyond MVP)
- ✅ 6. Edge inspector
- ✅ 7. Agent surfaces — shipped as per-concern toolbar modals, not the originally-specced persistent sidebar (see [Design decisions § Agent surfaces](#agent-surfaces-are-per-concern-modals-not-a-persistent-sidebar))
- ✅ 8. Add / delete flows + drag-to-connect
- ✅ 9. Basic graph validation
- ✅ 10. Interactive LLM chat (BYOK Google) — 2026-05-02
- ✅ 11. Simulate panel (text chat against the runner) — 2026-05-04

**Beyond the original plan, also shipped:** Variables editor (was post-MVP), Tables CRUD (was post-MVP), `entry_flow_id` picker in Agent sheet, delete buttons in inspectors, schema-doc sync, AGENT-SPEC-PROMPT.txt rewritten for one-shot JSON output, Simulate variables form with LLM-powered value generation, system-prompt codegen ([lib/codegen/promptGenerator.ts](./lib/codegen/promptGenerator.ts)), canvas highlight of active flow + last-traversed edge during simulate.

**Top candidates for next:** ingestion-parser quality (system prompts / transcripts / markdown), deep graph validation (unreachable calculation exits + knowledge-coverage gaps), and the steps editor.

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

## Design decisions

### Editor surfaces

- **Canvas (React Flow)** is the primary editor. Flows as nodes, `routing.exit_paths` as edges.
- **Scripts sheet** is a node-attached tabular editor: rows = utterances, columns = languages. Not a global view over the spec.
- **Agent-level collections** (Guardrails, FAQ, Glossary, Tables, Meta) live in per-concern modals; not canvas nodes in MVP.
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
- **Sidecars** (post-MVP) carry authoring metadata — `ui` (positions, colors, comments, share-view config) and `tests` (cases, runs, coverage). Runtimes MUST ignore. Two export modes (`exportSpec` strips them; `exportAll` preserves). See [SIDECARS.md](./SIDECARS.md).

### Agent surfaces are per-concern modals, not a persistent sidebar

The original chunk-7 plan called for a persistent left sidebar with tabs for Agent / Variables / Guardrails / Capabilities / Knowledge. Shipped instead as separate toolbar buttons, each opening a dedicated `SheetShell` modal. Functionally equivalent — every collection has an editor — and the modal-per-concern UX matched the rest of the editor better than a sibling sidebar would have. Tradeoff: less ambient visibility of agent-level state; mitigated by the canvas being the always-visible canonical surface.

### Chat is a peer authoring surface, not a copilot

Chunk-10's interactive LLM chat tool-calls mutate the same zustand store the inspectors do — the LLM becomes just another UI surface against the canonical canvas. This is the deliberate alternative to a one-shot paste-and-parse modal: edit-existing falls out for free since create-new and edit-existing are both sequences of mutator calls against whatever's currently in the store. Consistent with "canvas is canonical" instead of fighting it via text round-tripping (see [AGENTS.md § Authoring surfaces](./AGENTS.md#authoring-surfaces)). The chunk-10 watchlist item "Chat vs import as separate surfaces" is the open question of whether one-shot import warrants its own less-conversational surface alongside chat.

### Principles applied (from AGENTS.md)

- Schema defines behavior. UI defines rendering.
- Execution separate from spec.
- Flows are modular and reusable across agents.
- Findings are evidence, not certifications.

## Beyond MVP (deferred, with reasons)

- **System-prompt template on the agent.** Optional `agent.system_prompt_template` string with `{{double-brace}}` placeholders (at minimum `{{generated}}` = current deterministic output, plus convenience values from `meta`). Belongs in the schema — hard rules and persona framing inside it are behavior, and persistence must round-trip. Honored by monolithic-prompt codegen ([lib/codegen/promptGenerator.ts](./lib/codegen/promptGenerator.ts) and the generic config bundle); graph-native targets ignore. Cross-spec reuse via a localStorage-scoped library that copies content **into** the field, not via runtime reference. Deferred pending real templates from Nikunj to validate the placeholder vocabulary — designing against imagined templates risks shipping the wrong shape.
- **Deep graph validation** — variable-reference integrity, `exit_path.assigns` target validity, interrupt-flow `entry_condition` presence. UX target: surface failures inline at edit time on the offending edge or inspector field, not just at import. Two concrete checks surfaced by runner live-testing 2026-04-30:
  - **Unreachable calculation exits.** If an `exit_path.condition` is `method: "calculation"` and reads variable `X`, but no `exit_path.assigns` on any flow reachable from `entry_flow_id` ever produces `X`, the path is dead. Found a real instance in `examples/coffee.json` where `flow_greet`'s coffee/tea exits gated on `drink_type` but nothing set `drink_type` — the conversation deadlocked in flow_greet. Fix is usually changing the exit to `method: "llm"` with a `direct` assign that sets the variable.
  - **Knowledge-coverage gaps that invite confabulation.** When `flow.instructions` or `meta.purpose` mentions a concept that has no entry in `agent.knowledge.glossary`, no row in `agent.knowledge.tables`, and no capability matching the term, the LLM will invent details at runtime. Coffee.json mentioned "pastries" with no pastry table → LLM cheerfully invented "croissants, muffins, and danishes." Hard to catch perfectly (free text vs. structured knowledge), but a heuristic surfacing nouns in prompts not present in any structured knowledge would catch the obvious cases.
- **Sidecars** — `ui` and `tests` work (positions round-trip, comments, low-fi share view, test cases, runs, coverage), plus `exportSpec` / `exportAll` split. See [SIDECARS.md](./SIDECARS.md).
- **Steps editor** — structured turn sequencing, captures, per-turn conditions, utterance variations. `instructions` + scripts sheet is the MVP authoring surface.
- **Schema additions** — `tool` step (mid-conversation capability dispatch), `call` step (sub-flow invocation), runtime hints. Not in the schema today; arrive as a `$schema` version bump when implementation is ready. Open Questions in [SCHEMA.md](./SCHEMA.md) tracks the design surface. Capability catalog (`agent.capabilities[]`) and post-exit dispatch (`exit_path.actions[]`) are already supported end-to-end.
- **Scripts sheet row reorder.** Add/delete/edit only today; up/down arrow controls deferred. Watchlist UX item.
- **Export as text — multiple formats.** On-demand stringification of the spec for skim, stakeholder share, and code-comfortable authors. Three viable formats as siblings: **declarative YAML** (data-shaped, matches the current import format), **imperative pseudocode** (program-shaped — `flow greet (happy)` / `say` / `capture` / `on ... goto ...`, reads as source code; pairs cleanly with the "spec is a program" framing in [`../whatsupp2/STRATEGY.md`](../whatsupp2/STRATEGY.md)), and **markdown narrative** (prose-shaped, for embedding in Google Docs / stakeholder review). Read-only by default; if any becomes bidirectional, it replaces canvas state on re-import — never merge ([AGENTS.md](./AGENTS.md) explicitly avoids the round-trip-fragility trap). Cheap one-way; bidirectional earns its keep only if a customer wants imperative as their primary authoring surface.
- **Id rename with cascade update.** Routing-plumbing ids (`flow.id`, `exit_path.id`, `script_line.id`, `guardrail.id`, `business_goal.id`, `capability.id`-as-editor-handle, etc.) are immutable in MVP; delete-and-recreate to change. The runner walks them deterministically and the LLM never sees them — so the cosmetic value of renaming is low until eval data starts pinning to them. LLM-facing identifiers (`capability.name`, variable names, glossary `term`, FAQ `question`, guardrail `statement`) are already author-controlled and freely editable today.
- **Vertical templates.** Banking collections, healthcare intake, insurance claims, etc. Templates are regular specs — the cold-start UX is "load template → edit," same plumbing as the existing example loader. No template-specific schema fields.
- **Skip dagre re-layout when topology hasn't changed.** Today every spec mutation (including each keystroke in any inspector field) re-runs `buildGraph` + `dagre.layout` + `setNodes`/`setEdges` in [Canvas.tsx](./components/canvas/Canvas.tsx). Fine at MVP scale; will lag at 100+ flows. Surgical fix: re-layout only when flow ids or edge connectivity changes; for pure data updates (name, instructions, condition text), update node `data` in place, keep positions. Preserves live-preview while killing the hot-path cost.
- **Generate-example-transcript button.** One-shot "show me a plausible run of this flow" affordance — LLM samples a transcript from the spec, renders it inline for skim/share. Useful for stakeholder walkthroughs without standing up a runner. Today the SimulatePanel covers the live case; this is the static / paste-into-a-doc variant.
- **Versioning of specs and guardrails.** Specs and the guardrails they import need shared version semantics; treating them separately is wrong. Today the only persistence is whatsupp2's `runs.config_snapshot`, which freezes the spec at run time as a side-effect, not as authored history. A complete answer requires a storage decision that pulls against the browser-contained authoring posture: server-side history gives team-grade versioning and weakens the on-prem pitch; client-side history preserves the pitch and fails for teams; schema-only version fields are portable but leave users managing versioned files by hand. Pick when a customer forces it — likely when multi-author editing or a banking audit trail becomes load-bearing. Until then, the run snapshot is the de-facto record.

### Chat panel deferrals (chunk 10 watchlist)

- **Chat vs import as separate surfaces.** One-shot import (paste source → spec) and conversational editing are conceptually distinct intents. MVP collapses them into one chat panel; if usage shows the bulk-import case wants its own less-conversational surface, split later.
- **Multi-provider support.** Anthropic and OpenAI adapters, plus the provider/model selector UI, all land together when there's a second provider to justify them. The dispatch signature is provider-keyed from day one so this is additive.
- **Prompt caching.** Gemini caches stable prefixes implicitly — no API work needed as long as we keep `system prompt → tool schema → spec → conversation tail` ordering consistent across turns. Explicit Context Caching API only matters if we later want TTL control or to charge cached tokens to a named handle. Anthropic/OpenAI behave differently; revisit when adding a second provider.
- **Streaming.** Skip for MVP; add if latency feels bad in practice.
- **Context strategy.** Full spec each turn is fine at MVP scale. Switch to selective context when specs get big enough to matter.
- **Richer clarification UI.** Chat may eventually want structured prompts (multi-select pickers, inline diff confirmations) rather than free-text turn-taking. Defer.

## Risks

- **Scripts sheet UX needs care.** Row ordering must stay consistent across language columns. Empty cells (partial translation coverage) must be handled gracefully.
- **Inspector grows fast.** ListEditor, ConditionEditor, FlowPicker — build the primitives first or it becomes a bespoke mess.
- **Validation timing.** Ajv on every keystroke is wasteful; on-export-only misses authoring feedback. Debounced at ~300ms.
- **LLM-parsed specs are noisy.** Schema validation at import is load-bearing — half-valid specs cascading into the store are confusing. Reject hard, surface errors clearly.
