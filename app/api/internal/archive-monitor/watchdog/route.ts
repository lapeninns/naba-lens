import { startJobRun } from "@/lib/ops/heartbeat-writer"
import { watchdogResult } from "@/lib/ops/heartbeats"
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
  // The job is admitted: from here every invocation leaves one receipt.
  const run = startJobRun("archive_watchdog")
  try {
    const report = await runArchiveWatchdog({
      store: createWatchdogStore(),
      send: createWatchdogEmailSender(),
    })
    await run.finish(() => watchdogResult(report))
    return Response.json(report, {
      status: report.ok ? 200 : 503,
      headers: HEADERS,
    })
  } catch {
    await run.finish({ outcome: "failed", errorCode: "watchdog_failed" })
    return Response.json(
      { error: "watchdog_failed" },
      { status: 503, headers: HEADERS }
    )
  }
}
