// Writes docs/operations/metrics.md and docs/operations/runbooks/README.md
// from lib/ops, formatted with the repository's Prettier settings.
//
//   pnpm exec tsx scripts/ops/write-docs.ts
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { formattedOpsDocs } from "./docs-format"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

async function main() {
  for (const [path, text] of await formattedOpsDocs(root)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
    console.log(`wrote ${path}`)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
