import "server-only"

import {
  parseInbox,
  parsePreferences,
  type Inbox,
  type NotificationPreferences,
} from "@/lib/ops/notifications"
import { apiError, fromDbError } from "@/lib/server/http/errors"
import { redactError } from "@/lib/server/log/redact"
import type { Db } from "@/lib/server/media/types"
import type { OpsCaller, OpsResult } from "@/lib/server/ops/types"

// In-app notifications (spec §17; FA-10; 20261118106200_ops_notifications.sql).
// Notices are written by the database (triggers on committed decisions and
// the hourly job), never by the app, so a notice exists only for something
// that really happened. Screens read them as an inbox list and a badge; there
// are no toasts. Sprint 2 places the inbox on Me (staff) and Review
// (manager); admins see exceptions on Settings.

function logged(context: string, error: { code?: string; message?: string }) {
  console.error(`[notifications] ${context} failed`, {
    error: redactError(
      new Error(`${error.code ?? "unknown"}: ${error.message ?? ""}`)
    ),
  })
}

/** The caller's notices, newest first; `before` is the previous page's nextBefore. */
export async function loadInbox(
  caller: OpsCaller,
  before: number | null = null,
  limit = 30
): Promise<OpsResult<{ inbox: Inbox }>> {
  const { data, error } = await caller.db.rpc("my_notifications", {
    p_before: before ?? undefined,
    p_limit: limit,
  })
  if (error) {
    const mapped = fromDbError(error)
    if (mapped.code === "unavailable") logged("inbox read", error)
    return mapped
  }
  const inbox = parseInbox(data)
  return inbox ? { ok: true, inbox } : apiError("unavailable")
}

/** The badge number: unread and unresolved notices. Null when it can't be read. */
export async function unreadCount(caller: OpsCaller): Promise<number | null> {
  const { data, error } = await caller.db.rpc("my_notification_count")
  if (error) {
    if (fromDbError(error).code === "unavailable") logged("count", error)
    return null
  }
  return typeof data === "number" ? data : null
}

/** Marks the given notices read (all when ids is null). Returns how many changed. */
export async function markRead(
  caller: OpsCaller,
  ids: number[] | null
): Promise<OpsResult<{ changed: number }>> {
  if (
    ids &&
    (ids.length > 500 || !ids.every((id) => Number.isSafeInteger(id) && id > 0))
  )
    return apiError("invalid_input", { field: "ids" })
  const { data, error } = await caller.db.rpc("mark_notifications_read", {
    p_ids: ids ?? undefined,
  })
  if (error) {
    const mapped = fromDbError(error)
    if (mapped.code === "unavailable") logged("mark read", error)
    return mapped
  }
  return { ok: true, changed: typeof data === "number" ? data : 0 }
}

export async function loadPreferences(
  caller: OpsCaller
): Promise<OpsResult<{ preferences: NotificationPreferences }>> {
  const { data, error } = await caller.db.rpc("my_notification_preferences")
  if (error) {
    const mapped = fromDbError(error)
    if (mapped.code === "unavailable") logged("preferences read", error)
    return mapped
  }
  const preferences = parsePreferences(data)
  return preferences ? { ok: true, preferences } : apiError("unavailable")
}

export type PreferencesPatch = Partial<
  Pick<
    NotificationPreferences,
    "retakes" | "assignments" | "uploadProblems" | "digests"
  >
> & { quietStart?: string | null; quietEnd?: string | null }

export async function saveNotificationPreferences(
  caller: OpsCaller,
  patch: PreferencesPatch
): Promise<OpsResult<{ preferences: NotificationPreferences }>> {
  const { data, error } = await caller.db.rpc(
    "set_my_notification_preferences",
    {
      p_patch: patch,
    }
  )
  if (error) {
    const mapped = fromDbError(error, {
      invalid_quiet_hours: {
        field: "quietStart",
        message: "Give both times as 24-hour times, such as 21:00 and 08:00.",
      },
    })
    if (mapped.code === "unavailable") logged("preferences save", error)
    return mapped
  }
  const preferences = parsePreferences(data)
  return preferences ? { ok: true, preferences } : apiError("unavailable")
}

export type NotificationJobReport = {
  digests: number
  exceptions: number
  resolved: number
}

/**
 * One run of the hourly job (service role): manager digests and admin
 * exceptions, then the run recorded in ops_job_runs. A failure is recorded
 * too, so monitoring shows it.
 */
export async function runNotificationJobs(
  service: Db,
  now?: Date
): Promise<
  { ok: true; report: NotificationJobReport } | { ok: false; errorCode: string }
> {
  const startedAt = new Date().toISOString()
  const { data, error } = await service.rpc("ops_run_notification_jobs", {
    p_now: now?.toISOString(),
  })
  if (error || !data || typeof data !== "object") {
    if (error) logged("job", error)
    await recordJobRun(service, {
      job: "notification_jobs",
      state: "failed",
      startedAt,
      errorCode: "notification_job_failed",
    })
    return { ok: false, errorCode: "notification_job_failed" }
  }
  const d = data as Record<string, unknown>
  const report: NotificationJobReport = {
    digests: typeof d.digests === "number" ? d.digests : 0,
    exceptions: typeof d.exceptions === "number" ? d.exceptions : 0,
    resolved: typeof d.resolved === "number" ? d.resolved : 0,
  }
  await recordJobRun(service, {
    job: "notification_jobs",
    state: "succeeded",
    startedAt,
    detail: report,
  })
  return { ok: true, report }
}

/**
 * Records one finished job run (service role) for monitoring. Never throws:
 * a recording failure is logged and the job's own result stands. Detail holds
 * counts only, never object keys, URLs or secrets.
 */
export async function recordJobRun(
  service: Db,
  run: {
    job: string
    state: "succeeded" | "failed"
    startedAt?: string
    errorCode?: string
    detail?: Record<string, number | string | boolean | null>
    attempts?: number
    venueId?: string
    subjectId?: string
  }
): Promise<void> {
  try {
    const { error } = await service.rpc("ops_record_job_run", {
      p_job: run.job,
      p_state: run.state,
      p_started_at: run.startedAt,
      p_error_code: run.errorCode,
      p_detail: run.detail ?? {},
      p_attempts: run.attempts ?? 1,
      p_venue_id: run.venueId,
      p_subject_id: run.subjectId,
    })
    if (error) logged("job record", error)
  } catch (error) {
    console.error("[notifications] job record failed", {
      error: redactError(error),
    })
  }
}
