# @flowstore/core

Schema, codegen, validation, files, and runtime helpers for flowstore. Consumed by `@flowstore/browser` in this workspace; intended to publish to npm as a standalone library.

## Workspace vs. publish

`package.json` `exports` point at **`src/*.ts`**. This is what workspace siblings (the browser app, dev scripts run via `tsx`) consume — no rebuild step needed; vite/tsx handle TS on the fly.

`tsup` builds **`dist/`** (ESM + CJS + .d.ts) for npm consumers. The dist layout mirrors `src/` one-to-one — see `tsup.config.ts` `entry`.

When `npm publish` actually wires up, the published tarball's `package.json` needs `exports`/`main`/`types` rewritten to point at `dist/`. **npm does not do this automatically** — `publishConfig` only overrides `access`/`registry`/`tag`/`provenance`, not manifest paths. Pick one of:

- [`clean-publish`](https://github.com/shashkovdanil/clean-publish) — devDep that rewrites the tarball manifest at publish time. Lowest-friction add.
- Custom prepack script that swaps fields.
- Migrate the monorepo to pnpm, which natively extends `publishConfig` to override `exports`/`main`/`types`.

## Adding a new exported subpath

Two edits, in lockstep:

1. `package.json` `exports` — add `"./your/path": "./src/your/path.ts"`.
2. `tsup.config.ts` `entry` — add `"your/path": "src/your/path.ts"`.

Plus, when the publish path is wired up, the rewrite mechanism needs to know about the new dist entry too.
