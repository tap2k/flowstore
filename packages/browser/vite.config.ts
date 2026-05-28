import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Repo root holds AGENT-SPEC-PROMPT.txt, which the app bundles as a raw string
// (`@root/AGENT-SPEC-PROMPT.txt?raw`) so the in-editor parser and the
// doc-linked file are the same source. fs.allow lets the dev server read it.
const repoRoot = path.resolve(__dirname, "../..");

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
});
