import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL("../../", import.meta.url))

// Runs against the isolated lifecycle stack (tests/lifecycle/prepare-stack.mjs);
// a separate invocation keeps the foundation-owned harness unchanged.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: root },
      // The route handler and lib/server/lifecycle/index.ts are server-only; that
      // guard throws outside Next's react-server build.
      {
        find: /^server-only$/,
        replacement: fileURLToPath(
          new URL("./server-only-stub.ts", import.meta.url)
        ),
      },
    ],
  },
  test: {
    include: ["tests/lifecycle/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
