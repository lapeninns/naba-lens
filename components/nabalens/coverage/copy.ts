// Copy, limits and small display helpers for the manager/admin coverage
// screens. Pure: safe in Server and Client Components. Review vocabulary is
// "Accept" / "Needs another photo" / "reason" (docs/spec v0.4).

import type { CoverageFailure, PeriodKey, RequirementKind } from "./types"

/**
 * Copy keyed by a DTO union value. String-keyed on purpose: the service unions
 * may gain or lose members, and an unknown value still gets a readable label
 * through `labelFor` instead of breaking the build or the page.
 */
export type CopyMap = Readonly<Record<string, string>>

/** "needs_another_photo" → "Needs another photo". */
export function humanise(value: string): string {
  const text = value.replace(/_/g, " ").trim()
  return text ? text[0].toUpperCase() + text.slice(1) : value
}

export function labelFor(map: CopyMap, key: string): string {
  return Object.hasOwn(map, key) ? map[key] : humanise(key)
}

/** Same numbers as the services and database (checked by a unit test). */
export const COVERAGE_LIMITS = {
  titleMax: 120,
  guidanceMax: 2000,
  factsMax: 2000,
  reasonMax: 500,
  photoTargetMax: 200,
  targetCountMax: 500,
  batchMax: 10,
  assigneesMax: 50,
  factAssetsMax: 20,
} as const

export const REQUIREMENT_KIND_LABEL: CopyMap = {
  menu_section: "Menu sections",
  amenity: "Amenities",
  service: "Venue and service areas",
  venue_specific: "Venue-specific",
}

export const REQUIREMENT_KIND_SINGULAR: CopyMap = {
  menu_section: "Menu section",
  amenity: "Amenity",
  service: "Venue or service area",
  venue_specific: "Venue-specific item",
}

export const REQUIREMENT_KIND_ORDER: RequirementKind[] = [
  "service",
  "amenity",
  "venue_specific",
  "menu_section",
]

export const REQUIREMENT_STATUS_LABEL: CopyMap = {
  needs_setup: "Needs setup",
  active: "Active",
  not_applicable: "Not applicable",
  retired: "Retired",
}

export const SETUP_ISSUE_LABEL: CopyMap = {
  unconfirmed: "Confirm whether this applies and its photo target",
  fact_unknown: "Needs verification: record whether it is present",
  fact_unconfirmed: "Confirm the amenity facts",
  fact_absent: "Recorded as not present: mark it not applicable with a reason",
  no_assignees: "No one is assigned",
  needs_reassignment: "Assignees left or moved venue: reassign",
}

export const SUBMISSION_STATE_LABEL: CopyMap = {
  submitted: "Submitted",
  accepted: "Accepted",
  needs_another_photo: "Needs another photo",
}

export const SUBMISSION_ORIGIN_LABEL: CopyMap = {
  submitted: "Submitted by the photographer",
  attached: "Attached by a manager",
  reconciled: "Carried over from the previous menu",
}

export const PRESENCE_LABEL: CopyMap = {
  present: "Present",
  absent: "Not present",
  unknown: "Needs verification",
}

export const MENU_STATE_LABEL: CopyMap = {
  no_menu: "No active menu",
  needs_setup: "Menu coverage needs setup",
  menu_changed: "Menu changed — review coverage",
  reconciliation_pending: "Menu changed — review coverage",
  current: "Menu coverage is current",
}

export const TARGET_SOURCE_LABEL: CopyMap = {
  manager: "Set by a manager",
  copied: "Copied from last month",
  placeholder: "Needs setup",
  admin_correction: "Corrected by an admin",
}

export const ASSET_REASON_LABEL: CopyMap = {
  // Deleted, still processing or, for managers, taken by someone who has left:
  // the services cannot tell these apart for a manager.
  not_found:
    "Not available: deleted, still processing or taken by someone who has left.",
  not_ready: "Still processing.",
  not_image: "Only photos count.",
  wrong_venue: "Taken at another venue.",
  uploader_inactive: "The photographer is no longer active.",
  // The database's spelling of uploader_inactive.
  inactive_uploader: "The photographer is no longer active.",
  already_submitted: "Already on this checklist item.",
  counted_elsewhere: "Already counts for another checklist item.",
  declined_here: "Marked “Needs another photo” here.",
  outside_period: "Uploaded in an earlier month.",
  evidence_removed: "The photo was deleted.",
}

export const REVOKE_KIND_LABEL: CopyMap = {
  revoked: "Revoked by an admin",
  venue_changed: "Ended: moved to another venue",
  deactivated: "Ended: account deactivated",
  role_changed: "Ended: no longer staff",
}

/** Copy repeated wherever teams appear next to assignment. */
export const TEAM_SUGGESTION_COPY =
  "Teams (FOH/BOH) only suggest who to assign. They do not give anyone extra access."

export const SELF_REVIEW_COPY =
  "Self-review: the reviewer took this photo. It is recorded for admins."

export const SELF_REVIEW_PENDING_COPY =
  "You took this photo. You can review it; the decision is recorded as a self-review and admins can see it."

export const SHARING_COPY =
  "Ready photos are already in portfolios and Explore. Review decides whether they count, not whether they are shared."

export const MANAGER_POWERS_COPY =
  "Venue managers set monthly targets, checklists and assignments, and review photos for their current venue. Being a manager does not let them invite or deactivate people, change roles, venues or teams, publish menus, download originals or delete colleagues’ photos."

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * Plain-language message for a failed coverage call. Service messages are safe
 * to show; a stale revision is refreshed automatically, so say so.
 */
export function failureText(failure: CoverageFailure): string {
  if (failure.code === "revision_conflict") {
    return "Someone else changed this a moment ago. The latest version is now shown; check it and try again if you still need to."
  }
  return failure.message
}

/** Codes after which the page must re-read server data before acting again. */
export function needsRefresh(failure: CoverageFailure): boolean {
  return (
    failure.code === "revision_conflict" ||
    failure.code === "state_conflict" ||
    failure.code === "not_found" ||
    failure.code === "not_permitted" ||
    failure.code === "wrong_venue"
  )
}

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

/** Last London calendar day of a "YYYY-MM" period (calendar maths only). */
export function lastDayOfPeriod(period: PeriodKey): string {
  const match = PERIOD_PATTERN.exec(period)
  if (!match) return ""
  const days = new Date(
    Date.UTC(Number(match[1]), Number(match[2]), 0)
  ).getUTCDate()
  return `${period}-${String(days).padStart(2, "0")}`
}

export function firstDayOfPeriod(period: PeriodKey): string {
  return PERIOD_PATTERN.test(period) ? `${period}-01` : ""
}

const periodFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/** "November 2026" for "2026-11" (calendar only, no time-zone maths). */
export function periodKeyLabel(period: PeriodKey): string {
  const match = PERIOD_PATTERN.exec(period)
  if (!match) return period
  return periodFormatter.format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
  )
}

const localDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

/** "30 Nov 2026" for a London calendar date "YYYY-MM-DD". */
export function localDateLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  return localDateFormatter.format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  )
}
