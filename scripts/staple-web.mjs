// Staple the brand site and the app into one deployable tree:
//   packages/site/dist     -> dist-web/            (flowstore.org)
//   packages/browser/dist  -> dist-web/            (/create/, /compare/, /assets/…)
// One Cloudflare Pages project serves the result — one origin, so the
// compare->editor localStorage handoff and the shared settings keys work.
// Invoked by `npm run build:web` (which runs the app and site builds first);
// deploy dist-web/.
import { cpSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Anchor to the repo root so the script is cwd-independent — rmSync on a
// relative path from the wrong directory would delete the wrong tree.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-web");
const SITE = path.join(root, "packages/site/dist");
const APP = path.join(root, "packages/browser/dist");

function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, acc);
    else acc.push(path.relative(base, p));
  }
  return acc;
}

for (const src of [SITE, APP]) {
  if (!existsSync(src)) {
    console.error(`missing ${src} — run \`npm run build:web\` (it builds both halves first)`);
    process.exit(1);
  }
}

// No silent winners: the two trees must be disjoint. The day the app build
// re-emits a root index.html (a reverted entry move, a third entry), the
// brand homepage would be replaced without this check ever failing a build.
const site = new Set(walk(SITE));
const collisions = walk(APP).filter((f) => site.has(f));
if (collisions.length > 0) {
  console.error(`staple collision — same path in both builds:\n  ${collisions.join("\n  ")}`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
cpSync(SITE, out, { recursive: true });
cpSync(APP, out, { recursive: true });

// Post-conditions: the four files the deploy exists to serve.
for (const f of ["index.html", "create/index.html", "compare/index.html", "_headers"]) {
  if (!existsSync(path.join(out, f))) {
    console.error(`staple postcondition failed: dist-web/${f} missing`);
    process.exit(1);
  }
}
console.log(`stapled -> ${out}`);
