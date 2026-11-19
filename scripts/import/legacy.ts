/**
 * Legacy import (FA-54; docs/legacy-import.md). Owner/admin operation:
 * run against staging first, never from CI.
 *
 *   pnpm import:legacy --folder <dir> --manifest <file.csv> --admin <email>
 *                      [--label <name>] [--out <result.csv>] [--apply]
 *
 * Dry run unless --apply: reads only and writes the result CSV saying what
 * --apply would do. Re-running the same manifest changes nothing.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and
 * SUPABASE_SERVICE_ROLE_KEY in the environment (as `pnpm seed:venues`).
 * Never prints keys. Exits 1 when any line failed (fix and run again: done
 * lines are skipped), 2 on an error before any line ran.
 */
import "../lib/server-runtime.mjs"

import { readFile, writeFile } from "node:fs/promises"
import { basename } from "node:path"

import { createServiceClientFromEnv, parseArgs } from "../lib/service-client"

const USAGE =
  "Usage: pnpm import:legacy --folder <dir> --manifest <file.csv> --admin <email> [--label <name>] [--out <result.csv>] [--apply]"

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const folder = typeof args.folder === "string" ? args.folder : null
  const manifestPath = typeof args.manifest === "string" ? args.manifest : null
  const adminEmail = typeof args.admin === "string" ? args.admin : null
  if (!folder || !manifestPath || !adminEmail) throw new Error(USAGE)
  const apply = args.apply === true
  const label =
    typeof args.label === "string" ? args.label : basename(manifestPath)
  const out =
    typeof args.out === "string"
      ? args.out
      : manifestPath.replace(
          /(\.csv)?$/i,
          apply ? ".result.csv" : ".dry-run.csv"
        )

  // Load server modules only after the explicit Node server context.
  const { runLegacyImport, resultCsv } = await import("./legacy-import")
  const report = await runLegacyImport({
    service: createServiceClientFromEnv(),
    folder,
    manifest: await readFile(manifestPath, "utf8"),
    label,
    adminEmail,
    apply,
  })
  await writeFile(out, resultCsv(report.rows), "utf8")

  const c = report.counts
  const summary = apply
    ? `imported ${c.imported}, duplicates skipped ${c.duplicate}, unchanged ${c.unchanged}, failed ${c.failed}`
    : `would import ${c.would_import}, would skip as duplicates ${c.would_skip_duplicate}, unchanged ${c.unchanged}, failed ${c.failed}`
  console.log(
    `import:legacy ${apply ? "applied" : "dry run (nothing written; add --apply)"}: ${summary}.`
  )
  console.log(`import:legacy: results in ${out}`)
  if (c.failed > 0) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(
    `import:legacy: ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 2
})
