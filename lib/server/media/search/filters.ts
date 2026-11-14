import { isObject, isUuid } from "@/lib/server/coverage/validate"
import { londonDayRange } from "@/lib/server/media/library"

import {
  ANSWER_FRESHNESS_STATES,
  ANSWER_USES,
  MENU_DECISION_STATES,
  SEARCH_FILTER_KEYS,
  SEARCH_MEDIA_TYPES,
  SEARCH_RIGHTS,
  SUBMISSION_SOURCES,
  type AnswerFreshnessState,
  type AnswerUse,
  type AssetSearchDbFilters,
  type AssetSearchFilters,
  type MenuDecisionState,
  type SearchFilterKey,
  type SearchRights,
  type SubmissionSource,
} from "./types"

const DESTINATION_KEY = /^[a-z0-9_]{3,64}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

export type ParsedSearchFilters =
  | { ok: true; filters: AssetSearchFilters; db: AssetSearchDbFilters }
  | { ok: false; fieldErrors: Record<string, string> }

const absent = (v: unknown) => v === undefined || v === null || v === ""

function choice<T extends string>(
  list: readonly T[],
  v: unknown
): T | undefined {
  return typeof v === "string" && (list as readonly string[]).includes(v)
    ? (v as T)
    : undefined
}

// Both bounds of the day must be ISO instants with a four-digit year from 0001
// (the database rejects '+010000-…' and year 0): 9999-12-31 ends in year 10000.
const INSTANT_YEAR = /^(?!0000)\d{4}-/

/** A valid London calendar day, YYYY-MM-DD; undefined when invalid. */
function day(v: unknown): string | undefined {
  if (typeof v !== "string" || !DAY.test(v)) return undefined
  const { start, end } = londonDayRange(v, v)
  return start && end && INSTANT_YEAR.test(start) && INSTANT_YEAR.test(end)
    ? v
    : undefined
}

/**
 * Checks a filter object field by field. Absent, null and "" values are no
 * filter; an unknown key or an invalid value is a field error (the database
 * repeats every check). Upload days become a half-open UTC range.
 */
export function parseSearchFilters(input: unknown): ParsedSearchFilters {
  if (absent(input)) return { ok: true, filters: {}, db: {} }
  if (!isObject(input))
    return { ok: false, fieldErrors: { filters: "Reload the page." } }
  const errors: Record<string, string> = {}
  const filters: AssetSearchFilters = {}

  for (const key of Object.keys(input))
    if (!(SEARCH_FILTER_KEYS as readonly string[]).includes(key))
      errors[key] = "This filter is not available."

  const value = (key: SearchFilterKey) =>
    absent(input[key]) ? undefined : input[key]

  for (const key of ["venue", "item", "variant", "check", "group"] as const) {
    const v = value(key)
    if (v === undefined) continue
    if (isUuid(v)) filters[key] = v.toLowerCase()
    else errors[key] = "Choose from the list."
  }

  const mediaType = value("mediaType")
  if (mediaType !== undefined) {
    const t = choice(SEARCH_MEDIA_TYPES, mediaType)
    if (t) filters.mediaType = t
    else errors.mediaType = "Choose photos or videos."
  }

  const submission = value("submission")
  if (submission !== undefined) {
    const source =
      isObject(submission) &&
      choice<SubmissionSource>(SUBMISSION_SOURCES, submission.source)
    const keys = isObject(submission) ? Object.keys(submission) : []
    if (
      source &&
      isUuid(submission.id) &&
      keys.every((k) => k === "source" || k === "id")
    )
      filters.submission = { source, id: submission.id.toLowerCase() }
    else errors.submission = "Choose a submission from the list."
  }

  const rights = value("rights")
  if (rights !== undefined) {
    const r = choice<SearchRights>(SEARCH_RIGHTS, rights)
    if (r) filters.rights = r
    else errors.rights = "Choose a use state."
  }

  const destination = value("destination")
  if (destination !== undefined) {
    if (typeof destination !== "string" || !DESTINATION_KEY.test(destination))
      errors.destination = "Choose a destination from the list."
    else if (filters.rights !== "in_force")
      errors.destination = "A destination narrows photos in use only."
    else filters.destination = destination
  }

  const menuState = value("menuState")
  if (menuState !== undefined) {
    const s = choice<MenuDecisionState>(MENU_DECISION_STATES, menuState)
    if (s) filters.menuState = s
    else errors.menuState = "Choose a menu decision."
  }

  const answerFreshness = value("answerFreshness")
  if (answerFreshness !== undefined) {
    const s = choice<AnswerFreshnessState>(
      ANSWER_FRESHNESS_STATES,
      answerFreshness
    )
    if (s) filters.answerFreshness = s
    else errors.answerFreshness = "Choose an answer freshness."
  }

  const answerUse = value("answerUse")
  if (answerUse !== undefined) {
    const u = choice<AnswerUse>(ANSWER_USES, answerUse)
    if (!u) errors.answerUse = "Choose internal or public."
    else if (!filters.answerFreshness && !errors.answerFreshness)
      errors.answerUse = "Choose an answer freshness first."
    else filters.answerUse = u
  }

  for (const key of ["uploadedFrom", "uploadedTo"] as const) {
    const v = value(key)
    if (v === undefined) continue
    const d = day(v)
    if (d) filters[key] = d
    else errors[key] = "Enter a valid date."
  }
  if (
    filters.uploadedFrom &&
    filters.uploadedTo &&
    filters.uploadedFrom > filters.uploadedTo
  )
    errors.uploadedTo = "The end date must not be before the start date."

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors }

  const { uploadedFrom, uploadedTo, ...rest } = filters
  const range = londonDayRange(uploadedFrom ?? null, uploadedTo ?? null)
  const db: AssetSearchDbFilters = { ...rest }
  if (range.start) db.uploadedFrom = range.start
  if (range.end) db.uploadedBefore = range.end
  return { ok: true, filters, db }
}
