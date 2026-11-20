import { logger } from "@/lib/server/log/logger"
import { archiveBearerAuthorized } from "@/lib/server/archive/authorization"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 60
const headers = { "Cache-Control": "private, no-store" }

/**
 * Scheduled menu activation (S1-MENUS, spec §4.3): every 15 minutes Vercel
 * Cron activates each draft whose approved time has passed
 * (public.menu_activate_due_all, service role only). Idempotent; a schedule
 * whose draft or retirements changed lapses instead. Menu pages also promote
 * due schedules of their venue when they load. No user session is involved.
 */
export async function GET(request: Request) {
  return run(request)
}

/** Same as GET, for a manual trigger by operations. */
export async function POST(request: Request) {
  return run(request)
}

async function run(request: Request) {
  const auth = archiveBearerAuthorized(request)
  if (auth !== "ok")
    return Response.json(
      { error: auth === "unconfigured" ? "not_configured" : "unauthorized" },
      { status: auth === "unconfigured" ? 503 : 401, headers }
    )
  try {
    const { data, error } = await createAdminClient().rpc(
      "menu_activate_due_all"
    )
    if (error) {
      // SQLSTATE only: no venue, menu or database text.
      logger.error("menu scheduled activation failed", error.code)
      return Response.json(
        { error: "activation_failed" },
        { status: 500, headers }
      )
    }
    return Response.json(
      { status: "succeeded", activated: typeof data === "number" ? data : 0 },
      { status: 200, headers }
    )
  } catch {
    logger.error("menu scheduled activation failed")
    return Response.json(
      { error: "activation_failed" },
      { status: 500, headers }
    )
  }
}
