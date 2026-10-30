// Runs one media cleanup pass (docs/cleanup.md) with the service role.
//
//   pnpm cleanup
//
// Needs NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in
// the environment. Remote sources also require the bound archive configuration
// documented in docs/media-archive.md; a missing mode never disables backups.
// Prints the JSON report; exits 1 when a removal failed (the
// assets stay hidden and the next run retries them) and 2 on an error.
import "./lib/server-runtime.mjs"
import { createServiceClientFromEnv } from "./lib/service-client"

async function main() {
  // Load only after the explicit Node server context has been installed.
  const { runMediaCleanup } = await import("../lib/server/lifecycle/cleanup")
  const { readArchiveConfig } = await import("../lib/server/archive/config")
  // Validate before even acquiring a cleanup lease or tombstoning candidates.
  readArchiveConfig()
  const report = await runMediaCleanup(createServiceClientFromEnv())
  console.log(JSON.stringify(report, null, 2))
  if (report.status === "completed" && report.failed.length > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 2
})
