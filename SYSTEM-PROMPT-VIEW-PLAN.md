# System Prompt View — Plan

A right-side panel showing the compiled system prompt with each section labeled and color-coded by source, and click-linked back to the spec entity it came from. Sits alongside Simulate and Chat as a third **consumer-of-the-spec** surface — read-only by default, with an explicit Edit mode for prompt overrides used by Simulate sessions.

The collapsible system-prompt textarea inside [SimulatePanel.tsx:380-420](packages/browser/components/runtime/SimulatePanel.tsx#L380-L420) goes away in favor of this panel.

---

## UX shape

- New **Prompt** panel mounted in [index.tsx:123](packages/browser/pages/index.tsx#L123) next to `SimulatePanel` and `ChatPanel`.
- New pill button at top-right of the canvas next to Simulate/Chat in [index.tsx:100-119](packages/browser/pages/index.tsx#L100-L119).
- **Mutually exclusive** with Simulate and Chat (the right-side trio): opening one closes the others. Today Simulate + Chat can both be open; this change makes the right-side slot single-tenant. **Validate before implementing** — confirm no one actively uses Simulate + Chat side-by-side.
- Header: **`View | Edit raw`** segmented toggle, **Copy**, **Language selector** (disabled in Edit mode — see below), **Legend** popover.
- Each compiled section is rendered as a labeled block:
  - A small `<button>` header above the block carries the **source label** (`Role`, `Guardrails`, `Flow: Verify caller`, `Interrupt: Caller asks for human`, `Knowledge`). The label is the click target and the keyboard focus target. Body text below is plain.
  - The block has a background tint keyed to source kind (table below). Labels supplement color so the encoding doesn't depend on it.
  - Hover: slightly darker tint + cursor: pointer. Focus: visible ring.
- In Edit mode the panel body becomes a plain textarea; labels/colors disappear (covered in Edit mode section).

## Source taxonomy, labels, and colors

Five top-level kinds, matching the renderers in [promptGenerator.ts:27-33](packages/core/src/codegen/promptGenerator.ts#L27-L33):

| Kind | Label | Source | Click target | Tint |
|---|---|---|---|---|
| `role` | `Role` | `agent.meta` | Open `AgentSheet` | zinc |
| `guardrails` | `Guardrails` | `agent.guardrails[]` | Open `GuardrailsSheet` | rose |
| `flow` | `Flow: <name>` | `flows[]` where `type ∉ {interrupt, utility}` | Select flow on canvas + center | sky |
| `interrupt` | `Interrupt: <name>` | `flows[]` where `type === "interrupt"` | Select flow on canvas + center | amber |
| `knowledge` | `Knowledge` | `agent.knowledge` (FAQ + glossary) | Open `KnowledgeSheet` | emerald |

Verify each tint clears WCAG AA contrast against the prompt text at the panel's font size before shipping. Tints listed are a starting point, not a finalized palette.

Phase 2 (deferred): sub-tinting within flow blocks (scripts / flow-guardrails / FAQ rows). Top-level linking first.

## Data model change

Change `generateSystemPrompt` in [promptGenerator.ts:19-37](packages/core/src/codegen/promptGenerator.ts#L19-L37) to return both the string and parallel segment offsets:

```ts
type PromptSource =
  | { kind: "role" }
  | { kind: "guardrails" }
  | { kind: "flow"; flowId: string; name: string }
  | { kind: "interrupt"; flowId: string; name: string }
  | { kind: "knowledge" };

interface PromptSegment {
  start: number;  // inclusive offset into text
  end: number;    // exclusive
  source: PromptSource;
}

interface CompiledPrompt {
  text: string;
  segments: PromptSegment[];
}

export function compileSystemPrompt(spec, vars?, opts?): CompiledPrompt;
```

Keep the existing `generateSystemPrompt(spec, vars?, opts?): string` as a wrapper (`compileSystemPrompt(...).text`) so existing callers — `ChatPanel`, `ImportExport.exportSystemPrompt`, round-trip scripts — don't change.

**Substitution must happen per-segment, before offsets are recorded.** Each renderer (`renderRole`, `renderGuardrails`, per-flow block, per-interrupt block, `renderKnowledge`) substitutes vars in its own text first, then the assembler concatenates and records final offsets. Doing substitution as a post-process would invalidate every segment's offsets after the first var replacement that changes string length. Fixture test: a spec with `{name}` in role and a flow section after must have correct offsets on both.

The `---` separators and trailing newline live outside any segment.

## Edit mode

Toggle between **View** (default, colored/labeled, read-only) and **Edit raw** (plain textarea, no segments). Borrowed from [SimulatePanel.tsx:391-407](packages/browser/components/runtime/SimulatePanel.tsx#L391-L407).

- **Banner appears only when edited text differs from the compiled prompt.** Single line: `Edited · N chars different · Revert`. The toggle button gets a small amber dot in this state.
- **Simulate uses the edited text if present, else the compiled text.** Same contract as the current SimulatePanel textarea, just relocated.
- **Spec-change escalation.** If the spec mutates while edited text exists, the banner upgrades to `Spec changed since edit · Revert to recompile`. Matches [SimulatePanel.tsx:370](packages/browser/components/runtime/SimulatePanel.tsx#L370). Detect via reference equality on the `spec` object (already triggers re-renders elsewhere).
- **Language selector is disabled in Edit mode.** The edited text is in whichever language it was edited in; silently re-rendering on language change would discard edits. Tooltip on the disabled selector: `Revert to change language`.
- **Revert** clears the edited text and returns to View mode synced with the current spec.

The stale-spec footer/notice exists only in Edit mode. In View mode the panel auto-recompiles on spec change, so no notice is needed.

## State location

**Edited-prompt state moves into `ui.ts`, not `simulate.ts`.** The Prompt panel produces it; the Simulate panel consumes it. Keeping it in `simulate.ts` would invert the dependency (a generic panel reading from a session-specific store). New slice:

```ts
// packages/browser/lib/store/ui.ts
type RightPanel = "simulate" | "chat" | "prompt" | null;

interface UiState {
  rightPanel: RightPanel;
  setRightPanel: (p: RightPanel) => void;

  promptOverride: string | null;     // null = use compiled
  setPromptOverride: (text: string | null) => void;
  promptOverrideSpecRef: object | null;  // identity of spec at edit time, for stale detection
}
```

`index.tsx` replaces `simulateOpen` / `chatOpen` booleans with `rightPanel`. Each panel receives `open={rightPanel === "simulate"}` etc. `useSimulateStore`'s `systemPrompt` / `setSystemPrompt` / `promptEdited` fields are removed; Simulate reads `promptOverride` from `ui.ts` when starting a session.

**Sheet-state lift NOT done in v1.** Only the Prompt panel needs cross-component sheet opening today. Pass a callback prop (`onOpenSheet: (kind: SheetKind) => void`) from `index.tsx` down to `SystemPromptPanel`; `index.tsx` proxies to `ImportExport`'s existing local state via a ref or by lifting just the setter (not the state). Revisit lifting to a store if a second cross-component caller appears (e.g., right-click on a canvas node).

## UI components

New files:

- `packages/browser/components/runtime/SystemPromptPanel.tsx` — the right-side panel. Header (View/Edit toggle, Copy, Language, Legend), body switches between labeled-segments view and textarea edit, banner.
- `packages/browser/lib/promptColors.ts` — single source of truth for source-kind → Tailwind classes mapping. Imported by panel and legend.

The panel reads `spec` directly from the store and recomputes `compileSystemPrompt` on change (pure, no session lifecycle).

## Canvas: center on external selection

[Canvas.tsx](packages/browser/components/canvas/Canvas.tsx) currently manages its own selection via `useNodesState` and doesn't react to the `selection` value in [spec.ts:18-20](packages/browser/lib/store/spec.ts#L18-L20). To make "click a flow section → jump to the node" work without also re-centering every time the user clicks a node *on* the canvas, add a one-shot intent:

```ts
// in spec.ts (or ui.ts)
focusRequest: { kind: "flow"; id: string; nonce: number } | null;
requestFocus: (kind: "flow", id: string) => void;  // increments nonce
```

Panel calls `requestFocus("flow", flowId)` and also `setSelection({ kind: "flow", id: flowId })`. Canvas subscribes to `focusRequest` only — on change, looks up the node, calls `setCenter(x, y, { zoom: currentZoom, duration: 250 })` via `useReactFlow()`, reads current zoom first so panning doesn't reset it. The nonce ensures repeated clicks on the same section retrigger centering. Canvas's own click-a-node handling continues to set selection without setting `focusRequest`, so no self-centering.

## Implementation order

1. **`compileSystemPrompt` + segments** in `@uxflows/core`. Unit tests:
   - `text` matches existing `generateSystemPrompt` byte-for-byte on Tala + coffee fixtures.
   - Segments cover all non-separator text without overlap.
   - Each segment's `source` matches the expected entity.
   - Fixture with vars in early section: offsets stay correct for later sections after substitution.
2. **`ui.ts` store** with `rightPanel`, `promptOverride`, `promptOverrideSpecRef`, `focusRequest`. Migrate `index.tsx` to `rightPanel` for Simulate/Chat. Confirm mutual exclusion isn't a regression for current users.
3. **`promptColors.ts`** + **`SystemPromptPanel.tsx`** — render labeled colored read-only view, View/Edit toggle, copy button, language selector, legend, banner. Wire clicks: flow/interrupt → `requestFocus` + `setSelection`; role/guardrails/knowledge → `onOpenSheet(...)` callback.
4. **Pill button + mount** in `index.tsx`. Place between Simulate and Chat pills. Wire `onOpenSheet` callback into `ImportExport`'s sheet state.
5. **Canvas focus wiring** — subscribe to `focusRequest`, `setCenter` on change.
6. **Migrate Simulate to read `promptOverride` from `ui.ts`.** Remove `systemPrompt` / `setSystemPrompt` / `promptEdited` from `simulate.ts`. Remove the collapsible textarea from `SimulatePanel`.
7. **Verify** on Tala (multi-flow, bilingual) and coffee (single-flow):
   - Every section is labeled and clickable; keyboard tab through section headers works.
   - Color contrast verified against AA at the rendering font size.
   - Flow/interrupt clicks center the canvas without disturbing zoom; canvas clicks don't re-center.
   - Edit mode: banner appears on divergence; spec change escalates banner; revert recompiles; Simulate uses edited text.
   - Language selector disabled in Edit mode with tooltip.
   - Copy puts plain text on the clipboard (no markup).
   - Opening Prompt closes Simulate/Chat and vice versa.

## Out of scope (v1)

- Sub-tinting inside flow blocks. Top-level only.
- Highlighting / scrolling the destination sheet to the row a click came from. Open the sheet at default scroll.
- Sub-agent / multi-agent prompt views. Single-agent shape only.
- Pinning two right-side panels open at once. Mutually exclusive.
- Lifting sheet open/close state into a store. Callback prop until a second caller exists.

## Open questions

- **Mutual exclusion of right-side panels.** Validate no current workflow needs Simulate + Chat open at the same time. If it does, revisit — possibly two slots (top/bottom or left/right of the right gutter), or keep Simulate/Chat stackable and slot Prompt into a separate position.
- **Variables substitution in View mode.** SimulatePanel currently passes `contextVars` into `generateSystemPrompt`. The Prompt panel has no session — show **un-substituted** template (placeholders intact)? v1 proposal: un-substituted, since the panel inspects the compiled spec, not a specific session. In Edit mode the user can substitute by hand if they want.
- **Language default.** v1: `defaultLanguage(spec.agent.meta.languages)`. Cross-surface language sync (panel ↔ active Simulate session) is a separate concern.
