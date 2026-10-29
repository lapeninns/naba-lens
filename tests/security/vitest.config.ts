import { defineConfig } from "vitest/config"

// Separate invocation preserves the foundation-owned test harness.
export default defineConfig({
  test: {
    include: ["tests/security/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
