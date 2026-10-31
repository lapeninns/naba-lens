import {
  createWatchdogEmailSender,
  createWatchdogStore,
  monitorAuthorized,
  runArchiveWatchdog,
} from "@/lib/server/archive-monitor"

export const maxDuration = 60
const HEADERS = { "Cache-Control": "private, no-store" }

export async function GET(request: Request) {
  const authorized = monitorAuthorized(request, "watchdog")
  if (authorized !== "ok") {
    return Response.json(
      { error: authorized },
      { status: authorized === "unconfigured" ? 503 : 401, headers: HEADERS }
    )
  }
  try {
    const report = await runArchiveWatchdog({
      store: createWatchdogStore(),
      send: createWatchdogEmailSender(),
    })
    return Response.json(report, {
      status: report.ok ? 200 : 503,
      headers: HEADERS,
    })
  } catch {
    return Response.json(
      { error: "watchdog_failed" },
      { status: 503, headers: HEADERS }
    )
  }
}
