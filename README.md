# uxflows

The browser editor in **UX4 — a Behavioral IDE for Conversational Agents**. Authors conversation specs on a canvas, decomposes them into per-concern files in a Git repo, and pairs with a Python testing surface and a static client-share view. Specs conform to [SCHEMA.md](./SCHEMA.md); the on-disk layout is in [FILE-MODEL.md](./FILE-MODEL.md); the staged plan is in [MVP-PLAN.md](./MVP-PLAN.md).

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

- [MVP-PLAN.md](./MVP-PLAN.md) — organizing vision and staged plan to the UX4 Browser MVP (Nov 2026).
- [SCHEMA.md](./SCHEMA.md) — authoritative spec data model.
- [FILE-MODEL.md](./FILE-MODEL.md) — how a UX4 project decomposes into files on disk.
- [AGENTS.md](./AGENTS.md) — architecture, tech stack, design principles.
- [TRANSLATIONS.md](./TRANSLATIONS.md) — runtime translation tables (Pipecat, LiveKit, LangGraph, Dialogflow CX, OpenAI Agents SDK).
- [docs/testing-from-scripts.md](./docs/testing-from-scripts.md) — bring-your-own-script testing path; `ux4-compile` CLI + file shapes engineers need to know.
- [AGENT-SPEC-PROMPT.txt](./AGENT-SPEC-PROMPT.txt) — LLM prompt for parsing source material into spec JSON.

## Stack

Next.js 16 (Pages Router) · React 19 · TypeScript · Tailwind v4 · `@xyflow/react`
