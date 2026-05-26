# flowstore

The browser editor in **flowstore — a Behavioral IDE for Conversational Agents**. Authors conversation specs on a canvas, decomposes them into per-concern files in a Git repo, and pairs with a Python testing surface and a static client-share view. Specs conform to [SCHEMA.md](./SCHEMA.md); the on-disk layout is in [FILE-MODEL.md](./FILE-MODEL.md); the staged plan is in [MVP-PLAN.md](./docs/mvp-plan.md).

## Run

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5173.

## Repo layout

npm workspaces monorepo (`packages/*`):

- `@flowstore/browser` — the Vite app you ran above. The editor surface.
- `@flowstore/core` — schema, codegen, validation, files, runtime. Intended to publish to npm. See [packages/core/README.md](./packages/core/README.md).
- `@flowstore/site` — placeholder marketing site (Astro, Cloudflare Pages).

## What it does

- Canvas-first authoring: flows as nodes, exit paths as edges.
- Schema-driven inspectors for flows, exit paths, and agent-level collections (guardrails, FAQ, glossary, tables, capabilities, variables).
- Multilingual scripts with spreadsheet round-trip for external translators.
- Ajv + graph-rule validation surfaced inline during authoring.
- Deterministic system-prompt codegen.
- LLM-assisted spec authoring (bring your own Google API key).
- Simulate panel — chat against a generated system prompt, or against a paired runner with live canvas highlighting.

## Docs

- [docs/getting-started.md](./docs/getting-started.md) — first pass through the core loop: author a spec, simulate it, export a system prompt.
- [SCHEMA.md](./SCHEMA.md) — authoritative spec data model.
- [FILE-MODEL.md](./FILE-MODEL.md) — how a flowstore project decomposes into files on disk.
- [AGENTS.md](./AGENTS.md) — architecture, tech stack, design principles.
- [TRANSLATIONS.md](./TRANSLATIONS.md) — runtime translation tables (Pipecat, LiveKit, LangGraph, Dialogflow CX, OpenAI Agents SDK).
- [prompts/](./prompts/) — LLM prompts used in the loop: [AGENT-SPEC-PROMPT.txt](./prompts/AGENT-SPEC-PROMPT.txt) parses source material into spec JSON; [GOLD-EXTRACTION-PROMPT.txt](./prompts/GOLD-EXTRACTION-PROMPT.txt) extracts gold transcripts from source materials; [CASE-FROM-GOLD-PROMPT.txt](./prompts/CASE-FROM-GOLD-PROMPT.txt) derives test cases from gold transcripts.

## Stack

Vite 7 · React 19 · TypeScript · Tailwind v4 · `@xyflow/react`
