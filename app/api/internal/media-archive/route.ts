import { startJobRun, type JobRun } from "@/lib/ops/heartbeat-writer"
import { archiveAuditResult } from "@/lib/ops/heartbeats"
import { archiveBearerAuthorized } from "@/lib/server/archive/authorization"
import { runArchiveAudit } from "@/lib/server/archive/audit"
import { readArchiveConfig } from "@/lib/server/archive/config"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 600
const headers = { "Cache-Control": "private, no-store" }

export async function GET(request: Request) {
  const auth = archiveBearerAuthorized(request)
  if (auth !== "ok")
    return Response.json(
      { error: auth },
      {
        status: auth === "unconfigured" ? 503 : 401,
        headers,
      }
    )
  // Set once the configuration admits the job; guard exits leave no receipt.
  let run: JobRun | null = null
  try {
    const config = readArchiveConfig()
    if (!config) {
      if (
        process.env.VERCEL_ENV &&
        process.env.NABALENS_ENVIRONMENT === "staging"
      )
        return Response.json({ status: "disabled", skipped: true }, { headers })
      throw new Error("archive_disabled")
    }
    run = startJobRun("media_archive")
    const report = await runArchiveAudit(createAdminClient())
    await run.finish(() => archiveAuditResult(report))
    // partial, locked and idle are normal for a cycle that spans invocations.
    if (report.outcome === "failed") {
      console.error("media archive audit failed")
      return Response.json(
        { error: "archive_audit_failed", outcome: report.outcome },
        { status: 500, headers }
      )
    }
    const ok =
      report.outcome === "completed_cycle" ||
      report.outcome === "partial" ||
      report.outcome === "locked" ||
      report.outcome === "idle"
    return Response.json(report, { status: ok ? 200 : 503, headers })
  } catch {
    // Provider details, source names, object keys and credentials stay out of logs.
    console.error("media archive audit failed")
    await run?.finish({ outcome: "failed", errorCode: "archive_audit_failed" })
    return Response.json(
      { error: "archive_audit_failed" },
      { status: 500, headers }
    )
  }
}
