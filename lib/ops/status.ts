// Operational monitoring (spec §8 A7, §16; 20261118106300_ops_monitoring.sql).
// Pure and client-safe: parsing ops_status and the words for each exception.

import { EXCEPTION_WORDS } from "./notifications"

export type StorageState = "ok" | "warning" | "full"

export type OpsException = {
  topic: string
  venueId: string | null
  venueName: string | null
  detail: Record<string, unknown>
}

export type OpsJob = {
  job: string
  lastRunAt: string | null
  lastState: string
  lastErrorCode: string | null
  lastSuccessAt: string | null
  failuresLastWeek: number
}

export type OpsStatus = {
  generatedAt: string
  storage: {
    usedBytes: number
    quotaBytes: number
    alertPercent: number
    percent: number
    state: StorageState
  }
  processing: {
    processing: number
    stuck: number
    oldestStuckAt: string | null
    failedLastDay: number
    failedLastWeek: number
  }
  archive: {
    lastRunAt: string | null
    outcome: string | null
    error: string | null
    lastCompletedCycleAt: string | null
  }
  preparation: { failedLast30Days: number; lastFailedAt: string | null }
  jobs: OpsJob[]
  restoreRehearsal: {
    lastAt: string | null
    state: string | null
    errorCode: string | null
  }
  exceptions: OpsException[]
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const s = (v: unknown) => (typeof v === "string" ? v : null)

export function parseOpsStatus(data: unknown): OpsStatus | null {
  const d = obj(data)
  if (typeof d.generatedAt !== "string") return null
  const storage = obj(d.storage)
  const processing = obj(d.processing)
  const archive = obj(d.archive)
  const preparation = obj(d.preparation)
  const rehearsal = obj(d.restoreRehearsal)
  const state = storage.state
  return {
    generatedAt: d.generatedAt,
    storage: {
      usedBytes: n(storage.usedBytes),
      quotaBytes: n(storage.quotaBytes),
      alertPercent: n(storage.alertPercent),
      percent: n(storage.percent),
      state: state === "warning" || state === "full" ? state : "ok",
    },
    processing: {
      processing: n(processing.processing),
      stuck: n(processing.stuck),
      oldestStuckAt: s(processing.oldestStuckAt),
      failedLastDay: n(processing.failedLastDay),
      failedLastWeek: n(processing.failedLastWeek),
    },
    archive: {
      lastRunAt: s(archive.lastRunAt),
      outcome: s(archive.outcome),
      error: s(archive.error),
      lastCompletedCycleAt: s(archive.lastCompletedCycleAt),
    },
    preparation: {
      failedLast30Days: n(preparation.failedLast30Days),
      lastFailedAt: s(preparation.lastFailedAt),
    },
    jobs: (Array.isArray(d.jobs) ? d.jobs : []).flatMap((raw): OpsJob[] => {
      const j = obj(raw)
      if (typeof j.job !== "string") return []
      return [
        {
          job: j.job,
          lastRunAt: s(j.lastRunAt),
          lastState: s(j.lastState) ?? "unknown",
          lastErrorCode: s(j.lastErrorCode),
          lastSuccessAt: s(j.lastSuccessAt),
          failuresLastWeek: n(j.failuresLastWeek),
        },
      ]
    }),
    restoreRehearsal: {
      lastAt: s(rehearsal.lastAt),
      state: s(rehearsal.state),
      errorCode: s(rehearsal.errorCode),
    },
    exceptions: (Array.isArray(d.exceptions) ? d.exceptions : []).flatMap(
      (raw): OpsException[] => {
        const e = obj(raw)
        if (typeof e.topic !== "string") return []
        return [
          {
            topic: e.topic,
            venueId: s(e.venueId),
            venueName: s(e.venueName),
            detail: obj(e.detail),
          },
        ]
      }
    ),
  }
}

const JOB_WORDS: Record<string, string> = {
  media_cleanup: "Upload cleanup",
  notification_jobs: "Digests and exceptions",
  export: "Export packages",
  restore_rehearsal: "Restore rehearsal",
}

export function jobWords(job: string): string {
  return JOB_WORDS[job] ?? job.replaceAll("_", " ")
}

/** One exception as a title and a line of detail. */
export function exceptionText(e: OpsException): {
  title: string
  detail: string
} {
  const title = EXCEPTION_WORDS[e.topic] ?? "Something needs attention"
  const d = e.detail
  const venue = e.venueName ? `${e.venueName}: ` : ""
  switch (e.topic) {
    case "storage":
      return {
        title,
        detail: `Over ${n(d.alertPercent)}% of the quota is used. Raise the quota or plan an archive; nothing is deleted automatically.`,
      }
    case "processing":
      return {
        title,
        detail: `${n(d.stuck)} stuck in processing, ${n(d.failedLastDay)} failed in the last day.`,
      }
    case "job":
      return {
        title,
        detail: `${jobWords(s(d.job) ?? "job")}: ${s(d.errorCode) ?? "failed"}.`,
      }
    case "archive":
      return {
        title,
        detail: `Last run: ${s(d.error) ?? s(d.outcome) ?? "failed"}.`,
      }
    case "preparation":
      return { title, detail: `${venue}${s(d.errorCode) ?? "failed"}.` }
    case "backlog":
      return {
        title,
        detail: `${venue}${n(d.waiting)} waiting, the oldest for more than ${n(d.thresholdDays)} days.`,
      }
    case "venue_setup": {
      const gaps = [
        d.noActiveMenu ? "no current menu" : null,
        d.noManager ? "no manager" : null,
      ].filter(Boolean)
      return { title, detail: `${venue}${gaps.join(" and ")}.` }
    }
    default:
      return { title, detail: venue.replace(/: $/, "") }
  }
}
