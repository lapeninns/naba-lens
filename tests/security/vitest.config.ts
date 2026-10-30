import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL("../../", import.meta.url))

// Separate invocation preserves the foundation-owned test harness. The `@/`
// alias lets hardening.test.ts drive the app's own read path (lib/server/media)
// with real signed-in identities.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: root }],
  },
  test: {
    include: ["tests/security/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
