import { archiveBearerAuthorized } from "@/lib/server/archive/authorization"
import { runArchiveAudit } from "@/lib/server/archive/audit"
import { readArchiveConfig } from "@/lib/server/archive/config"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 120
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
    const report = await runArchiveAudit(createAdminClient())
    return Response.json(report, {
      status: report.status === "locked" || report.complete ? 200 : 503,
      headers,
    })
  } catch {
    // Provider details, source names, object keys and credentials stay out of logs.
    console.error("media archive audit failed")
    return Response.json(
      { error: "archive_audit_failed" },
      { status: 500, headers }
    )
  }
}
