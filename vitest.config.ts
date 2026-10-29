import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL("./", import.meta.url))

export default defineConfig({
  resolve: {
    alias: { "@/": root },
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
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
