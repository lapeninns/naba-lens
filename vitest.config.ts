import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

// Minimal shared test config. Component tests opt into jsdom per file with
// `// @vitest-environment jsdom`; everything else runs in node.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
  },
})
