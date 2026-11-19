import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL("../../", import.meta.url))

// Scratch config for docs/reviews/upload-path-review.md repros (not committed).
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: root },
      {
        find: /^server-only$/,
        replacement: fileURLToPath(
          new URL("../lifecycle/server-only-stub.ts", import.meta.url)
        ),
      },
    ],
  },
  test: {
    include: ["tests/security/upload-path-review.repro.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
