import { logger } from "@/lib/server/log/logger"
import { archiveBearerAuthorized } from "@/lib/server/archive/authorization"
import { runNotificationJobs } from "@/lib/server/notifications"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 60
const headers = { "Cache-Control": "private, no-store" }

/**
 * Hourly notification job (spec §17): manager review digests outside quiet
 * hours and admin exceptions (20261118106300_ops_monitoring.sql). Vercel Cron
 * sends GET with `Authorization: Bearer $CRON_SECRET`; CLEANUP_SECRET holds
 * the same value. Idempotent: dedupe keys make a repeated run write nothing.
 * No user session is involved; the response holds counts only.
 */
export async function GET(request: Request) {
  return runAuthorised(request)
}

/** Same as GET, for a manual trigger by operations. */
export async function POST(request: Request) {
  return runAuthorised(request)
}

async function runAuthorised(request: Request) {
  const auth = archiveBearerAuthorized(request)
  if (auth !== "ok")
    return Response.json(
      { error: auth === "unconfigured" ? "not_configured" : "unauthorized" },
      { status: auth === "unconfigured" ? 503 : 401, headers }
    )
  try {
    const result = await runNotificationJobs(createAdminClient())
    if (!result.ok)
      return Response.json(
        { error: result.errorCode },
        { status: 500, headers }
      )
    return Response.json(
      { status: "succeeded", ...result.report },
      { status: 200, headers }
    )
  } catch {
    logger.error("notification job failed")
    return Response.json(
      { error: "notification_job_failed" },
      { status: 500, headers }
    )
  }
}
