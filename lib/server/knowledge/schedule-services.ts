import "server-only"

import {
  SCHEDULE_EXCEPTION_KINDS,
  type KnowledgeResult,
  type OccurrenceRow,
  type ScheduleExceptionKind,
} from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"

import { safeDate } from "./dates"
import { knowledgeInvalid, knowledgeRpcFailure } from "./errors"
import { knowledgeRpc } from "./rpc"
import {
  scheduleProblems,
  scheduleWindowProblems,
  type Occurrence,
} from "./schedules"
import { isObject, isUuid, NOT_FOUND } from "./validate"

// Schedules (B03-d, b03-design §6, A7, A8): the occurrences of the schedule
// in use, a preview of one being written, and a single-date exception.

const DAY = 86_400_000
const RELOAD = knowledgeInvalid(
  { idempotencyKey: "Reload the page and try again." },
  "This request is invalid. Reload the page."
)

const occurrence = (r: OccurrenceRow): Occurrence => ({
  localDate: r.local_date,
  startsAt: new Date(r.starts_at).toISOString(),
  endsAt: new Date(r.ends_at).toISOString(),
  state: r.state,
})

function dateRange(
  input: Record<string, unknown>
): { from: string; to: string } | null {
  const from = safeDate(input.from)
  const to = safeDate(input.to)
  if (!from || !to || to < from) return null
  if ((Date.parse(to) - Date.parse(from)) / DAY > 91) return null
  return { from, to }
}
const BAD_RANGE = knowledgeInvalid({ to: "Choose up to 92 days." })

/** The schedule in use for a check, from..to (at most 92 days). */
export async function getOccurrences(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ occurrences: Occurrence[] }>> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  const range = dateRange(input)
  if (!range) return BAD_RANGE
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_occurrences",
    {
      p_check_id: input.checkId,
      p_from: range.from,
      p_to: range.to,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge occurrences")
  return { ok: true, occurrences: data.map(occurrence) }
}

/** What a schedule being written would give; nothing is saved. */
export async function previewSchedule(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ occurrences: Occurrence[] }>> {
  if (!isObject(input)) return knowledgeInvalid({ schedule: "Add a schedule." })
  const fields = scheduleProblems("schedule", input.schedule)
  if (fields.length)
    return knowledgeInvalid(
      Object.fromEntries(fields.map((f) => [f.path, "Check this value."]))
    )
  const range = dateRange(input)
  if (!range) return BAD_RANGE
  const timezone = input.timezone ?? null
  if (timezone !== null && typeof timezone !== "string")
    return knowledgeInvalid({ timezone: "Reload the page and try again." })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_schedule_preview",
    {
      p_schedule: input.schedule as Record<string, unknown>,
      p_timezone: timezone,
      p_from: range.from,
      p_to: range.to,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge schedule preview")
  return { ok: true, occurrences: data.map(occurrence) }
}

/**
 * A venue manager or an admin: cancel, change or add one date on the
 * schedule in use. One change per date; the slot revision moves.
 */
export async function addScheduleException(
  actor: MediaActor,
  input: unknown
): Promise<
  KnowledgeResult<{
    exceptionId: string
    slotRevision: number
    replayed: boolean
  }>
> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  if (!isUuid(input.idempotencyKey)) return RELOAD
  const errors: Record<string, string> = {}
  if (
    typeof input.slotRevision !== "number" ||
    !Number.isSafeInteger(input.slotRevision) ||
    input.slotRevision < 0
  )
    errors.slotRevision = "Reload the page and try again."
  if (!isUuid(input.scheduleId))
    errors.scheduleId = "Reload the page and try again."
  const localDate = safeDate(input.localDate)
  if (!localDate) errors.localDate = "Choose a date."
  const kind = input.kind as ScheduleExceptionKind
  if (!SCHEDULE_EXCEPTION_KINDS.includes(kind))
    errors.kind = "Choose what changes on that date."
  const windows = input.windows ?? null
  if (kind === "cancelled" && windows !== null)
    errors.windows = "A cancelled date has no times."
  else if (
    kind !== "cancelled" &&
    scheduleWindowProblems("windows", windows).length
  )
    errors.windows = "Enter the times, for example 12:00 to 15:00."
  const note = input.note ?? null
  if (
    note !== null &&
    (typeof note !== "string" || note.trim().length === 0 || note.length > 500)
  )
    errors.note = "Use up to 500 characters."
  if (Object.keys(errors).length) return knowledgeInvalid(errors)
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_schedule_exception",
    {
      p_check_id: input.checkId,
      p_slot_revision: input.slotRevision as number,
      p_idempotency_key: input.idempotencyKey,
      p_schedule_id: input.scheduleId as string,
      p_local_date: localDate!,
      p_kind: kind,
      p_windows: windows as { start: string; end: string }[] | null,
      p_note: typeof note === "string" ? note.trim() : null,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge schedule exception")
  return { ok: true, ...data }
}
