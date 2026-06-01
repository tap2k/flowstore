import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// @flowstore/core is consumed in-source (no build step). Map the package
// specifier to its src so tests resolve the same TS the editor and CLI do.
const coreSrc = fileURLToPath(new URL("./packages/core/src", import.meta.url));
const browserSrc = fileURLToPath(new URL("./packages/browser/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@flowstore/core": coreSrc, "@": browserSrc },
  },
  test: {
    // Pure-logic tests only for now (node env). React component tests need a
    // jsdom project — added later.
    include: ["packages/core/**/*.test.ts", "packages/browser/**/*.test.ts"],
    environment: "node",
  },
});
