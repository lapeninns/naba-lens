import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL("./", import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: root },
      // v0.3: lib/server code reached through listLibrary (labels) is
      // server-only; that guard throws outside Next's react-server build.
      {
        find: /^server-only$/,
        replacement: fileURLToPath(
          new URL("./tests/lifecycle/server-only-stub.ts", import.meta.url)
        ),
      },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          // UI component tests opt into jsdom per file (`// @vitest-environment jsdom`).
          include: [
            "tests/unit/**/*.test.ts",
            "tests/ui/**/*.test.{ts,tsx}",
            "tests/media/**/*.test.ts",
            "tests/upload/**/*.test.ts",
          ],
          environment: "node",
        },
      },
      {
        // Runs against the LOCAL Supabase stack (`supabase start`), never a hosted project.
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/integration/setup-env.ts"],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
