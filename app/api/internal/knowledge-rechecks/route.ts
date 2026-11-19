import { createHash, timingSafeEqual } from "node:crypto"

import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 60

const NO_STORE = { "Cache-Control": "no-store" }

function secretMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * The hourly knowledge recheck job (b03-design §7.4; S1-FACTS, spec §9.3):
 * opens recheck tasks for answers past or near their check date and closes
 * the ones a current answer now satisfies. Same `Authorization: Bearer
 * <CLEANUP_SECRET>` as /api/internal/cleanup. Idempotent.
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
  const { data, error } = await createAdminClient().rpc(
    "knowledge_run_rechecks"
  )
  if (error) {
    console.error("knowledge rechecks failed", error.code ?? "error")
    return Response.json(
      { error: "rechecks_failed" },
      { status: 500, headers: NO_STORE }
    )
  }
  // Counts only.
  console.info("knowledge rechecks done", data)
  return Response.json(data, { status: 200, headers: NO_STORE })
}
