import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL("../../", import.meta.url))

// ARCHIVE_SUITE selects the layer: `unit` (default) is fully in-process;
// `db` and `e2e` need the Harness-owned ws2 stack and its env (see README.md).
const suite = process.env.ARCHIVE_SUITE ?? "unit"
const include = {
  unit: ["tests/archive/unit/**/*.test.ts"],
  db: ["tests/archive/db/**/*.test.ts"],
  e2e: ["tests/archive/e2e/**/*.test.ts"],
}[suite]
if (!include) throw new Error(`Unknown ARCHIVE_SUITE: ${suite}`)

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
    include,
    environment: "node",
    testTimeout: suite === "unit" ? 10_000 : 60_000,
    hookTimeout: 60_000,
    fileParallelism: suite === "unit",
  },
})
