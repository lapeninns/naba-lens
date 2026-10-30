import { archiveBearerAuthorized } from "@/lib/server/archive/authorization"
import { archiveStatus } from "@/lib/server/archive/audit"
import { createAdminClient } from "@/lib/supabase/admin"

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
    const report = await archiveStatus(createAdminClient())
    return Response.json(report, { status: report.ok ? 200 : 503, headers })
  } catch {
    return Response.json(
      { error: "archive_status_unavailable" },
      { status: 503, headers }
    )
  }
}
