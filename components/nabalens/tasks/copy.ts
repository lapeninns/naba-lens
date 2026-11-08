import type {
  AssetIneligibleReason,
  CoverageErrorCode,
  CoverageFailure,
  PeriodKey,
  RequirementKind,
  SubmissionState,
} from "./types"

const SUBMISSION_STATE_LABEL = {
  submitted: "Submitted",
  accepted: "Accepted",
  needs_another_photo: "Needs another photo",
} satisfies Partial<Record<SubmissionState, string>>

export type ReviewedState = keyof typeof SUBMISSION_STATE_LABEL

export function submissionStateLabel(state: SubmissionState): string {
  return SUBMISSION_STATE_LABEL[state as ReviewedState] ?? "Closed"
}

export const REQUIREMENT_KIND_LABEL: Record<RequirementKind, string> = {
  menu_section: "Menu",
  amenity: "Amenity",
  service: "Service",
  venue_specific: "Venue",
}

export function requirementKindLabel(kind: string): string {
  return REQUIREMENT_KIND_LABEL[kind as RequirementKind] ?? "Task"
}

/** Why one photo cannot be sent, as shown under its tile. */
const INELIGIBLE_COPY: Partial<Record<AssetIneligibleReason, string>> = {
  not_found: "This photo is no longer available.",
  not_ready: "Still processing. It can't count until it's ready.",
  evidence_removed: "This photo was deleted or is no longer available.",
  not_image: "Videos don't count toward photo tasks.",
  wrong_venue: "Taken at a different venue.",
  uploader_inactive: "This photo's uploader is no longer active.",
  already_submitted: "Already sent for this task.",
  declined_here: "Needs another photo here. Send a different one.",
  counted_elsewhere: "Already counting toward another task.",
  outside_period:
    "Uploaded before this month, so it can't count toward this month.",
}

export function ineligibleCopy(reason: string | null | undefined): string {
  return (
    (reason ? INELIGIBLE_COPY[reason as AssetIneligibleReason] : null) ??
    "This photo can't be sent."
  )
}

export type FailureAction = "retry" | "reload" | "sign_in" | null

export type FailureCopy = { message: string; action: FailureAction }

const FAILURE_COPY: Record<CoverageErrorCode, FailureCopy> = {
  unauthenticated: {
    message: "Your session has ended. Sign in again to continue.",
    action: "sign_in",
  },
  account_inactive: {
    message: "Your account is not active. Ask an admin if this is wrong.",
    action: null,
  },
  not_permitted: {
    message:
      "You can't send photos to this task any more. It may have been reassigned.",
    action: "reload",
  },
  wrong_venue: {
    message:
      "These photos were taken at a different venue, so they can't count here.",
    action: null,
  },
  not_found: {
    message: "This task is no longer available.",
    action: "reload",
  },
  invalid_input: {
    message: "Check your selection and try again.",
    action: null,
  },
  needs_setup: {
    message:
      "Your setup isn't finished, so photos can't be sent yet. Ask your manager or an admin.",
    action: null,
  },
  revision_conflict: {
    message:
      "Something changed while you were working. Reload to see the latest.",
    action: "reload",
  },
  state_conflict: {
    message:
      "This task changed (it may be closed or already updated). Reload to see the latest.",
    action: "reload",
  },
  asset_ineligible: {
    message: "None of these photos can be sent. See the reason under each one.",
    action: null,
  },
  unavailable: {
    message:
      "We couldn't send that just now. Your photos are safe. Try again in a moment.",
    action: "retry",
  },
}

/**
 * A send threw before its answer arrived: it may or may not have been
 * recorded. Try again reuses the request ID, so the server replays it.
 */
export function sendUnconfirmed(replacing: boolean): FailureCopy {
  return {
    message: replacing
      ? "We couldn't confirm your photo was sent. Check your connection and try again. Nothing is sent twice."
      : "We couldn't confirm your photos were sent. Check your connection and try again. Nothing is sent twice.",
    action: "retry",
  }
}

/** The action threw (dropped connection, timeout, server crash). */
export const NETWORK_FAILURE: FailureCopy = {
  message:
    "We couldn't reach Naba-Lens. Check your connection and try again. Nothing is sent twice.",
  action: "retry",
}

export function failureCopy(failure: CoverageFailure): FailureCopy {
  const copy = FAILURE_COPY[failure.code] ?? FAILURE_COPY.unavailable
  if (failure.code === "invalid_input") {
    const field = failure.fieldErrors?.assetIds
    return { ...copy, message: field ?? failure.message ?? copy.message }
  }
  if (failure.code === "needs_setup" && failure.message) {
    return { ...copy, message: failure.message }
  }
  return copy
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
})

/** "2 Nov 2026, 10:00" in Europe/London (tells same-day photos apart). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : dateTimeFormatter.format(date)
}

const PERIOD_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/** "2026-10" -> "October 2026". A calendar label, no time-zone conversion. */
export function periodLabel(key: PeriodKey): string {
  const match = PERIOD_KEY.exec(key)
  if (!match) return key
  return monthFormatter.format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
  )
}

export function isPeriodKey(value: unknown): value is PeriodKey {
  return typeof value === "string" && PERIOD_KEY.test(value)
}

/** The calendar month `delta` months from `key` ("2026-01", -1 -> "2025-12"). */
export function shiftPeriod(key: PeriodKey, delta: number): PeriodKey {
  const match = PERIOD_KEY.exec(key)
  if (!match) return key
  const index = Number(match[1]) * 12 + Number(match[2]) - 1 + delta
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${String(month).padStart(2, "0")}`
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}
