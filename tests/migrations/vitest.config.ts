import { defineConfig } from "vitest/config"

// Runs against an isolated stack (scripts/db/prepare-stack.mjs); a separate
// invocation keeps the foundation-owned harness unchanged. One file, in order:
// the steps share one database.
export default defineConfig({
  test: {
    include: ["tests/migrations/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 480_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
