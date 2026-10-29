// Runs one media cleanup pass (docs/cleanup.md) with the service role.
//
//   pnpm cleanup
//
// Needs NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in
// the environment. Prints the JSON report; exits 1 when a removal failed (the
// assets stay hidden and the next run retries them) and 2 on an error.
import { runMediaCleanup } from "../lib/server/lifecycle/cleanup"
import { createServiceClientFromEnv } from "./lib/service-client"

async function main() {
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
