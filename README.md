# flowstore

The browser editor in **flowstore — a Behavioral IDE for Conversational Agents**. Authors conversation specs on a canvas, decomposes them into per-concern files in a Git repo, and compiles a system prompt as a pure function of the spec. Specs conform to [SCHEMA.md](./SCHEMA.md); the on-disk layout is in [FILE-MODEL.md](./FILE-MODEL.md).

**Try it:** the hosted editor at [create.flowstore.org](https://create.flowstore.org) — nothing to install, runs in your browser.

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
- LLM-assisted spec authoring (bring your own LLM API key — Google, OpenAI, or OpenRouter).
- Simulate panel — chat against a generated system prompt, or against a paired runtime with live canvas highlighting.

## Compile

The same codegen the editor uses is exposed as a CLI in `@flowstore/core`, for compiling a spec outside the browser (CI, test harnesses, scripting):

```bash
# System prompt + tool schemas (JSON), from a single-file spec or a decomposed project dir:
npm -w @flowstore/core run --silent flowstore-compile -- examples/coffee/coffee.json --format prompt

# Resolved spec (single runtime-canonical JSON doc):
npm -w @flowstore/core run --silent flowstore-compile -- examples/coffee/coffee.json --format spec
```

Flags: `--format prompt|spec` (required), `--language <code>` (defaults to the first declared language — pass it for any other), `--vars-file <path.json>` / `--vars k=v` (substitute `{placeholder}` pre-context), `--out <path>`. A separate project repo points at a flowstore checkout via a `FLOWSTORE_COMPILE_CMD` env override (see the testing docs below); when flowstore ships a published CLI this collapses to `flowstore-compile`.

## Docs

- [GETTING-STARTED.md](./GETTING-STARTED.md) — first pass through the core loop: author a spec, simulate it, export a system prompt.
- [SCHEMA.md](./SCHEMA.md) — authoritative spec data model.
- [FILE-MODEL.md](./FILE-MODEL.md) — how a flowstore project decomposes into files on disk.
- [docs/testing-from-scripts.md](./docs/testing-from-scripts.md) — the bring-your-own-runner testing path: the compile contract, test-file shapes, and what a runner must do.
- [docs/test-driven-prompts.md](./docs/test-driven-prompts.md) — the methodology: authoring agent prompts test-first (golds, assertions, A/B, when to fix the spec vs the generator).
- [AGENTS.md](./AGENTS.md) — architecture, tech stack, design principles.
- [AGENT-SPEC-PROMPT.txt](./AGENT-SPEC-PROMPT.txt) — LLM prompt that parses source material into spec JSON.

- [GETTING-STARTED.md](./GETTING-STARTED.md) — first pass through the core loop: author a spec, simulate it, export a system prompt.
- [SCHEMA.md](./SCHEMA.md) — authoritative spec data model.
- [FILE-MODEL.md](./FILE-MODEL.md) — how a flowstore project decomposes into files on disk.
- [AGENTS.md](./AGENTS.md) — architecture, tech stack, design principles.
- [AGENT-SPEC-PROMPT.txt](./AGENT-SPEC-PROMPT.txt) — LLM prompt that parses source material into spec JSON.

## Examples

- [`examples/coffee`](./examples/coffee) — a minimal single-file spec; the ten-minute introduction.
- [`flowstore-example-fnol`](https://github.com/tap2k/flowstore-example-fnol) — the comprehensive worked example (Northwind FNOL insurance-intake agent), maintained as its own repository. Exercises every flow type and every test type, full file-model decomposition, multilingual scripts, and a self-contained Python testing harness. It compiles against any flowstore checkout via its `FLOWSTORE_COMPILE_CMD` override, and carries the gold-standard extraction prompt (`prompts/GOLD-EXTRACTION-PROMPT.txt`) that previously lived here.

## Stack

Vite 7 · React 19 · TypeScript · Tailwind v4 · `@xyflow/react`

## License

MIT — see [LICENSE](./LICENSE).
