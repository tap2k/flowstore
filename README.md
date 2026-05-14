# uxflows

Visual editor for UX4 behavioral specs. Authors flow-based conversational agent specifications and exports them as UX4-compatible JSON conforming to [SCHEMA.md](./SCHEMA.md).

## Status

MVP shipped (2026-05-08). Canvas authoring, schema-driven inspectors, scripts sheet, agent-level modals, Ajv + graph validation, system-prompt codegen, BYOK Google chat for spec authoring, and a Simulate panel that talks to [`../uxflows-runner/`](../uxflows-runner/) all live. See [MVP-PLAN.md](./MVP-PLAN.md) for the chunked work history and post-MVP roadmap; [AGENTS.md](./AGENTS.md) for architecture and design principles.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Docs

- [SCHEMA.md](./SCHEMA.md) — authoritative spec schema (the contract across all UX4 producers and consumers).
- [MVP-PLAN.md](./MVP-PLAN.md) — chunked work history, design decisions, and post-MVP roadmap.
- [TRANSLATIONS.md](./TRANSLATIONS.md) — runtime translation tables (Pipecat, LiveKit, LangGraph, OpenAI Agents SDK; import sources: Voiceflow, Botpress).
- [AGENT-SPEC-PROMPT.txt](./AGENT-SPEC-PROMPT.txt) — LLM prompt for parsing source material into v0 spec JSON, ready to paste into the editor's Import.
- [AGENTS.md](./AGENTS.md) — architecture, tech stack, design principles, MVP scope.
- [`../whatsupp2/AGENT-TESTING.md`](../whatsupp2/AGENT-TESTING.md) — product design doc (sibling repo).
- [`../whatsupp2/AGENT-CLAUDE.md`](../whatsupp2/AGENT-CLAUDE.md) — technical reference for the consuming application.

## Stack

Next.js 16 (Pages Router) · React 19 · TypeScript · Tailwind v4 · `@xyflow/react`
