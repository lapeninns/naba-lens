import { startJobRun } from "@/lib/ops/heartbeat-writer"
import { monthlyPreparationResult } from "@/lib/ops/heartbeats"
import { archiveBearerAuthorized } from "@/lib/server/archive/authorization"
import { runScheduledPreparation } from "@/lib/server/coverage/preparation"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 60
const headers = { "Cache-Control": "private, no-store" }

/**
 * Hourly monthly preparation (Vercel Cron sends GET with
 * `Authorization: Bearer $CRON_SECRET`; CLEANUP_SECRET holds the same value).
 * Idempotent: repeated or concurrent runs never duplicate targets or
 * checklist candidates. No user session is involved.
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
  // The job is admitted: from here every invocation leaves one receipt.
  const run = startJobRun("monthly_preparation")
  try {
    const result = await runScheduledPreparation(createAdminClient())
    if (!result.ok) {
      console.error("coverage monthly preparation failed")
      await run.finish({ outcome: "failed", errorCode: "preparation_failed" })
      return Response.json(
        { error: "preparation_failed" },
        { status: 500, headers }
      )
    }
    // Counts and SQLSTATE codes only: no people, venues' staff or database text.
    const runs = result.runs.map((r) => ({
      period: r.period,
      status: r.status,
      staffConsidered: r.staffConsidered,
      targetsCopied: r.targetsCopied,
      placeholdersCreated: r.placeholdersCreated,
      alreadyPresent: r.alreadyPresent,
      candidatesAdded: r.candidatesAdded,
      errorCode: r.errorCode,
    }))
    if (result.failed)
      console.error("coverage monthly preparation failed", {
        errorCodes: runs.map((r) => r.errorCode).filter(Boolean),
      })
    await run.finish(() => monthlyPreparationResult(result.runs))
    // A failure status makes the cron history show the run as failed; the
    // next hourly run retries.
    return Response.json(
      { status: result.failed ? "failed" : "succeeded", runs },
      { status: result.failed ? 500 : 200, headers }
    )
  } catch {
    console.error("coverage monthly preparation failed")
    await run.finish({ outcome: "failed", errorCode: "preparation_failed" })
    return Response.json(
      { error: "preparation_failed" },
      { status: 500, headers }
    )
  }
}
