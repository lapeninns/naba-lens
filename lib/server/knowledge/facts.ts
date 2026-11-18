import "server-only"

import type { KnowledgeResult } from "@/lib/knowledge/contract"
import type {
  FactCoverageView,
  FactStateView,
  GuestAnswersView,
  ReconfirmResult,
  SpacePhotoFreshnessRow,
} from "@/lib/knowledge/facts"
import type { Db, MediaActor } from "@/lib/server/media/types"

import { safeDate } from "./dates"
import {
  knowledgeFailure,
  knowledgeInvalid,
  knowledgeRpcFailure,
} from "./errors"
import { knowledgeRpc } from "./rpc"
import {
  intInRange,
  isObject,
  isUuid,
  NOT_FOUND,
  optionalVenueId,
} from "./validate"

// Facts and freshness (Full App v1 S1-FACTS; spec §9.2, §9.3, §14.3, §18.1).
// Each service checks the input's shape and calls one caller-scoped RPC; the
// database checks role, venue, state and dates again. Guest answers use the
// service client and are for a consuming service only.

const KEY = /^[a-z][a-z0-9_]{0,63}$/
const MAX_NOTE = 500

type Parsed<T> = { ok: true; value: T } | ReturnType<typeof knowledgeInvalid>

function venueId(input: unknown): Parsed<string> {
  const v = isObject(input) ? input.venueId : undefined
  return isUuid(v)
    ? { ok: true, value: v }
    : knowledgeInvalid({ venueId: "Choose a venue." })
}

function optionalDate(
  errors: Record<string, string>,
  field: string,
  v: unknown
): string | null {
  if (v === undefined || v === null || v === "") return null
  const date = safeDate(v)
  if (!date) errors[field] = "Choose a date."
  return date
}

function optionalNote(
  errors: Record<string, string>,
  field: string,
  v: unknown,
  required = false
): string | null {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
    if (required) errors[field] = "Say what has changed."
    return null
  }
  if (typeof v !== "string" || v.trim().length > MAX_NOTE) {
    errors[field] = `Use up to ${MAX_NOTE} characters.`
    return null
  }
  return v.trim()
}

/** Every in-scope question at the venue with its verification (managers, admins). */
export async function getFactStates(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ venueId: string; items: FactStateView[] }>> {
  const venue = venueId(input)
  if (!venue.ok) return venue
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_fact_states",
    {
      p_venue_id: venue.value,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge fact states")
  return { ok: true, venueId: data.venueId, items: data.items }
}

/** Spec §18.1 confirmed fact coverage (managers, admins). */
export async function getFactCoverage(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ coverage: FactCoverageView }>> {
  const venue = venueId(input)
  if (!venue.ok) return venue
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_fact_coverage",
    { p_venue_id: venue.value }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge fact coverage")
  return { ok: true, coverage: data }
}

/**
 * "Still right" (spec §9.3): reconfirms the answer in use without a new
 * finding or photo, with the day checked (default today) and optionally an
 * earlier next check. `reconfirm: false` only sets the next check.
 */
export async function reconfirmFact(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<ReconfirmResult>> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  const errors: Record<string, string> = {}
  if (!intInRange(input.slotRevision, 0, Number.MAX_SAFE_INTEGER))
    errors.slotRevision = "Reload the page and try again."
  const checkedOn = optionalDate(errors, "checkedOn", input.checkedOn)
  const nextCheckOn = optionalDate(errors, "nextCheckOn", input.nextCheckOn)
  const note = optionalNote(errors, "note", input.note)
  const reconfirm = input.reconfirm !== false
  if (!reconfirm && !nextCheckOn && !errors.nextCheckOn)
    errors.nextCheckOn = "Choose the date of the next check."
  if (Object.keys(errors).length) return knowledgeInvalid(errors)
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_reconfirm", {
    p_check_id: input.checkId,
    p_slot_revision: input.slotRevision as number,
    p_checked_on: checkedOn,
    p_next_check_on: nextCheckOn,
    p_note: note,
    p_reconfirm: reconfirm,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge reconfirm")
  return { ok: true, ...data }
}

/** Accepted space photos at the venue with their freshness (managers, admins). */
export async function listSpacePhotoFreshness(
  actor: MediaActor,
  input: unknown = {}
): Promise<KnowledgeResult<{ photos: SpacePhotoFreshnessRow[] }>> {
  const venue = optionalVenueId(input)
  if (!venue.ok) return venue
  const { data, error } = await knowledgeRpc(
    actor.db,
    "area_photo_freshness_list",
    { p_venue_id: venue.value }
  )
  if (error) return knowledgeRpcFailure(error, "area photo freshness")
  return { ok: true, photos: data }
}

/** "Still right" for a place: its accepted photos stay current (managers, admins). */
export async function reconfirmSpace(
  actor: MediaActor,
  input: unknown
): Promise<
  KnowledgeResult<{ subjectId: string; photos: number; checkedOn: string }>
> {
  if (!isObject(input) || !isUuid(input.subjectId))
    return knowledgeFailure(
      "not_found",
      "This place could not be found. Reload the page."
    )
  const errors: Record<string, string> = {}
  const checkedOn = optionalDate(errors, "checkedOn", input.checkedOn)
  const note = optionalNote(errors, "note", input.note)
  if (Object.keys(errors).length) return knowledgeInvalid(errors)
  const { data, error } = await knowledgeRpc(actor.db, "area_photo_reconfirm", {
    p_subject_id: input.subjectId,
    p_checked_on: checkedOn,
    p_note: note,
  })
  if (error) return knowledgeRpcFailure(error, "area photo reconfirm")
  return { ok: true, ...data }
}

/**
 * Reports a change to a place (anyone at the venue): its photos become check
 * due. A manager or admin may mark it a known change (`replacement: true`):
 * they need replacing.
 */
export async function reportSpaceChange(
  actor: MediaActor,
  input: unknown
): Promise<
  KnowledgeResult<{
    subjectId: string
    photos: number
    state: "check_due" | "needs_replacement"
  }>
> {
  if (!isObject(input) || !isUuid(input.subjectId))
    return knowledgeFailure(
      "not_found",
      "This place could not be found. Reload the page."
    )
  const errors: Record<string, string> = {}
  const reason = optionalNote(errors, "reason", input.reason, true)
  if (Object.keys(errors).length || !reason) return knowledgeInvalid(errors)
  const { data, error } = await knowledgeRpc(
    actor.db,
    "area_photo_report_change",
    {
      p_subject_id: input.subjectId,
      p_reason: reason,
      p_replacement: input.replacement === true,
    }
  )
  if (error) return knowledgeRpcFailure(error, "area photo report change")
  return { ok: true, ...data }
}

/** An explicit end date for one accepted space photo (spec §9.3 Expired). */
export async function setSpacePhotoEndDate(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ labelId: string; validUntil: string }>> {
  if (!isObject(input) || !isUuid(input.labelId))
    return knowledgeFailure(
      "not_found",
      "This photo could not be found. Reload the page."
    )
  const errors: Record<string, string> = {}
  const validUntil = optionalDate(errors, "validUntil", input.validUntil)
  if (!validUntil && !errors.validUntil) errors.validUntil = "Choose a date."
  const reason = optionalNote(errors, "reason", input.reason)
  if (Object.keys(errors).length || !validUntil) return knowledgeInvalid(errors)
  const { data, error } = await knowledgeRpc(
    actor.db,
    "area_photo_set_end_date",
    { p_label_id: input.labelId, p_valid_until: validUntil, p_reason: reason }
  )
  if (error) return knowledgeRpcFailure(error, "area photo end date")
  return { ok: true, labelId: data.labelId, validUntil: data.validUntil }
}

export type GuestAnswersResult =
  | { ok: true; view: GuestAnswersView }
  | { ok: false; code: "venue_not_found" | "invalid_input" | "unavailable" }

/**
 * Spec §14.3 structured answers for a consuming service, with the service
 * client (the only role allowed). Only a currently confirmed fact has a
 * value; overdue or unknown facts read unconfirmed or check_due.
 */
export async function readGuestAnswers(
  service: Db,
  venueId: string,
  keys: readonly string[],
  use: "internal" | "public" = "public"
): Promise<GuestAnswersResult> {
  if (!isUuid(venueId) || keys.length > 50 || !keys.every((k) => KEY.test(k)))
    return { ok: false, code: "invalid_input" }
  const { data, error } = await knowledgeRpc(
    service,
    "knowledge_guest_answers",
    {
      p_venue_id: venueId,
      p_keys: [...keys],
      p_use: use,
    }
  )
  if (!error) return { ok: true, view: data }
  if (error.code === "NLK06" || error.message === "knowledge_venue_not_found")
    return { ok: false, code: "venue_not_found" }
  if (error.code === "22023") return { ok: false, code: "invalid_input" }
  return { ok: false, code: "unavailable" }
}
