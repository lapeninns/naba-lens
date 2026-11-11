import { createHash, timingSafeEqual } from "node:crypto"

import { runDocumentCleanup } from "@/lib/server/documents"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 60

const NO_STORE = { "Cache-Control": "no-store" }

function secretMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Evidence document cleanup for a scheduler, with the same
 * `Authorization: Bearer <CLEANUP_SECRET>` as /api/internal/cleanup. Kept
 * apart from media cleanup so that route's report is unchanged.
 */
export async function POST(request: Request) {
  return runAuthorised(request)
}

/** Same as POST, for Vercel Cron (GET only). */
export async function GET(request: Request) {
  return runAuthorised(request)
}

async function runAuthorised(request: Request) {
  const secret = process.env.CLEANUP_SECRET
  if (!secret || secret.length < 32)
    return Response.json(
      { error: "cleanup_not_configured" },
      { status: 503, headers: NO_STORE }
    )
  const header = request.headers.get("authorization") ?? ""
  const given = header.startsWith("Bearer ") ? header.slice(7) : ""
  if (!secretMatches(given, secret))
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: NO_STORE }
    )
  try {
    const report = await runDocumentCleanup(createAdminClient())
    // Counts only: document ids and paths stay out of logs.
    console.info("document cleanup done", report)
    const failed = report.status === "completed" ? report.failed : 0
    return Response.json(report, {
      status: failed > 0 ? 500 : 200,
      headers: NO_STORE,
    })
  } catch (error) {
    console.error(
      "document cleanup failed",
      error instanceof Error ? error.message : "error"
    )
    return Response.json(
      { error: "cleanup_failed" },
      { status: 500, headers: NO_STORE }
    )
  }
}
