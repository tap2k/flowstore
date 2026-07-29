import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";

// Both entries must ship as ONE deployment on one origin: the compare →
// editor graduation reads the study and keys straight out of shared
// localStorage.

// Repo root holds AGENT-SPEC-PROMPT.txt, which the app bundles as a raw string
// (`@root/AGENT-SPEC-PROMPT.txt?raw`) so the in-editor parser and the
// doc-linked file are the same source. fs.allow lets the dev server read it.
const repoRoot = path.resolve(__dirname, "../..");

// Dev/preview convenience: the entries are path-shaped (/create/, /compare/)
// so the app can overlay the brand site in production — locally there is no
// site at /, so redirect the bare root to the editor.
import type { Plugin, Connect } from "vite";
function rootRedirect(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    // Bare root → editor; bare entry paths get their trailing slash (vite
    // dev serves create/index.html only at /create/). Pages handles both
    // in production.
    const target =
      req.url === "/" || req.url === "/index.html"
        ? "/create/"
        : req.url === "/create" || req.url === "/compare"
          ? `${req.url}/`
          : null;
    if (target) {
      res.statusCode = 302;
      res.setHeader("Location", target);
      res.end();
      return;
    }
    next();
  };
  return {
    name: "root-redirect",
    configureServer: (server) => {
      server.middlewares.use(handler);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(handler);
    },
  };
}

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
  plugins: [react(), tailwindcss(), rootRedirect()],
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
        // Path-shaped entries (/create/, /compare/) so the app overlays the
        // brand site on one origin (flowstore.org) — separate entries, not
        // routes: the app has no router, and each needs no SPA fallback.
        create: path.resolve(__dirname, "create/index.html"),
        compare: path.resolve(__dirname, "compare/index.html"),
      },
    },
  },
});
