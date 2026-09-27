import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Database tests boot Postgres (PGlite) and replay every migration + the seed.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
