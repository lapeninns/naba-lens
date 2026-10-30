import { createHash, timingSafeEqual } from "node:crypto"

import { runCleanup } from "@/lib/server/lifecycle"

// Storage removals for up to ten batches; the next run continues if cut short.
export const maxDuration = 60

const NO_STORE = { "Cache-Control": "no-store" }

/** Constant-time comparison that also hides the secret's length. */
function secretMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Media cleanup trigger for a scheduler (docs/cleanup.md), with
 * `Authorization: Bearer <CLEANUP_SECRET>`. No user session is involved; the
 * shared secret is the only credential. Other methods get Next's 405.
 */
export async function POST(request: Request) {
  return runAuthorised(request)
}

/**
 * Same as POST, for Vercel Cron, which can only send GET (with
 * `Authorization: Bearer $CRON_SECRET`; set CLEANUP_SECRET to the same value).
 * The secret check is identical, so a link or prefetch cannot trigger it.
 */
export async function GET(request: Request) {
  return runAuthorised(request)
}

async function runAuthorised(request: Request) {
  const secret = process.env.CLEANUP_SECRET
  if (!secret || secret.length < 32) {
    return Response.json(
      { error: "cleanup_not_configured" },
      { status: 503, headers: NO_STORE }
    )
  }

  const header = request.headers.get("authorization") ?? ""
  const given = header.startsWith("Bearer ") ? header.slice(7) : ""
  if (!secretMatches(given, secret)) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: NO_STORE }
    )
  }

  try {
    const report = await runCleanup()
    return Response.json(report, { headers: NO_STORE })
  } catch (error) {
    console.error("media cleanup failed", error)
    return Response.json(
      { error: "cleanup_failed" },
      { status: 500, headers: NO_STORE }
    )
  }
}
