# uxflows

Visual editor for UX4 behavioral specs. Authors conversational agent flows on a canvas and exports them as JSON conforming to [SCHEMA.md](./SCHEMA.md).

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## What it does

- Canvas-first authoring: flows as nodes, exit paths as edges.
- Schema-driven inspectors for flows, exit paths, and agent-level collections (guardrails, FAQ, glossary, tables, capabilities, variables).
- Multilingual scripts with spreadsheet round-trip for external translators.
- Ajv + graph-rule validation surfaced inline during authoring.
- Deterministic system-prompt codegen.
- LLM-assisted spec authoring (bring your own Google API key).
- Simulate panel — chat against a generated system prompt, or against a paired runner with live canvas highlighting.

## Docs

- [SCHEMA.md](./SCHEMA.md) — authoritative spec schema.
- [AGENTS.md](./AGENTS.md) — architecture, tech stack, design principles.
- [SIDECARS.md](./SIDECARS.md) — UI and testing sidecars; export modes.
- [TRANSLATIONS.md](./TRANSLATIONS.md) — runtime translation tables (Pipecat, LiveKit, LangGraph, Dialogflow CX, OpenAI Agents SDK).
- [MVP-PLAN.md](./MVP-PLAN.md) — design decisions and roadmap.
- [AGENT-SPEC-PROMPT.txt](./AGENT-SPEC-PROMPT.txt) — LLM prompt for parsing source material into v0 spec JSON.

## Stack

Next.js 16 (Pages Router) · React 19 · TypeScript · Tailwind v4 · `@xyflow/react`
