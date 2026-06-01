import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// @flowstore/core is consumed in-source (no build step). Map the package
// specifier to its src so tests resolve the same TS the editor and CLI do.
const coreSrc = fileURLToPath(new URL("./packages/core/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@flowstore/core": coreSrc },
  },
  test: {
    include: ["packages/core/**/*.test.ts"],
    environment: "node",
  },
});
