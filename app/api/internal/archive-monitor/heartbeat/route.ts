import {
  createWatchdogStore,
  monitorAuthorized,
} from "@/lib/server/archive-monitor"

export const maxDuration = 15
const HEADERS = { "Cache-Control": "private, no-store" }

export async function POST(request: Request) {
  const authorized = monitorAuthorized(request, "heartbeat")
  if (authorized !== "ok") {
    return Response.json(
      { error: authorized },
      { status: authorized === "unconfigured" ? 503 : 401, headers: HEADERS }
    )
  }
  try {
    // No client timestamp is accepted; the database sets its own clock.
    await createWatchdogStore().heartbeat()
    return Response.json({ ok: true }, { headers: HEADERS })
  } catch {
    return Response.json(
      { error: "heartbeat_store_unavailable" },
      { status: 503, headers: HEADERS }
    )
  }
}
