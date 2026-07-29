// Staple the brand site and the app into one deployable tree:
//   packages/site/dist     -> dist-web/            (flowstore.org)
//   packages/browser/dist  -> dist-web/            (/create/, /compare/, /assets/…)
// One Cloudflare Pages project serves the result — one origin, so the
// compare->editor localStorage handoff and the shared settings keys work.
// Run `npm run build:web`; deploy dist-web/.
import { cpSync, rmSync, existsSync } from "node:fs";

const out = "dist-web";
rmSync(out, { recursive: true, force: true });
for (const src of ["packages/site/dist", "packages/browser/dist"]) {
  if (!existsSync(src)) {
    console.error(`missing ${src} — run the builds first (build:site, build)`);
    process.exit(1);
  }
  cpSync(src, out, { recursive: true });
}
console.log(`stapled -> ${out}`);
