import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";

// ONE deployment, one origin (create.flowstore.org): editor at the root,
// compare at /compare.html. Same origin means settings/keys/PAT and the
// persisted study share between the two surfaces, so compare's "open in
// editor" graduation (lib/compareHandoff.ts) needs no export. There is no
// second domain — serving the files on one would recreate two isolated
// storage universes (compare.flowstore.org was retired for exactly that).

// Repo root holds AGENT-SPEC-PROMPT.txt, which the app bundles as a raw string
// (`@root/AGENT-SPEC-PROMPT.txt?raw`) so the in-editor parser and the
// doc-linked file are the same source. fs.allow lets the dev server read it.
const repoRoot = path.resolve(__dirname, "../..");

// `vite preview` serves the same response headers Cloudflare Pages will
// (public/_headers), so CSP violations surface in build+preview instead of
// only after a deploy. Parses the simple case we use: "Name: value" lines
// under the catch-all "/*" rule.
function pagesHeaders(): Record<string, string> {
  const src = fs.readFileSync(path.resolve(__dirname, "public/_headers"), "utf8");
  const out: Record<string, string> = {};
  for (const line of src.split("\n")) {
    const m = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@root": repoRoot,
    },
  },
  server: {
    host: "127.0.0.1",
    fs: { allow: [repoRoot] },
  },
  preview: {
    headers: pagesHeaders(),
  },
  build: {
    // Never inline assets as data: URLs. The capture worklet is imported via
    // `?url` and must resolve to a real same-origin file — script-src allows
    // 'self' but not data:, so an inlined worklet fails to load under the CSP.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        // The compare tool (/compare.html) — a separate entry, not a
        // route: the app has no router, and a second HTML entry needs no SPA
        // fallback on Pages.
        compare: path.resolve(__dirname, "compare.html"),
      },
    },
  },
});
