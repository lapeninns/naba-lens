import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL("../../", import.meta.url))

// Separate invocation preserves the foundation-owned test harness. The `@/`
// alias lets hardening.test.ts drive the app's own read path (lib/server/media)
// with real signed-in identities.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: root },
      // lib/server code imported by the regression tests is server-only; that
      // guard throws outside Next's react-server build.
      {
        find: /^server-only$/,
        replacement: fileURLToPath(
          new URL("../lifecycle/server-only-stub.ts", import.meta.url)
        ),
      },
    ],
  },
  test: {
    include: ["tests/security/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
