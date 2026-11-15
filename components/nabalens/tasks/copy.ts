import type {
  AssetIneligibleReason,
  CompletionProgress,
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

/** A photo for a checklist item at a completion-target venue. */
export const COMPLETION_ONLY =
  "Counts for this checklist item, not your monthly target."

/** Why one photo cannot be sent, as shown under its tile. */
const INELIGIBLE_COPY: Partial<Record<AssetIneligibleReason, string>> = {
  not_found: "This photo is no longer available.",
  not_ready: "Still processing. It can't count until it's ready.",
  evidence_removed: "This photo was deleted or is no longer available.",
  not_image: "Videos don't count toward photo tasks.",
  // The venue it was uploaded for: where it was taken isn't known.
  wrong_venue: "Uploaded for a different venue.",
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
      "These photos were uploaded for a different venue, so they can't count here.",
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

export function completionBreakdown({
  menuItems,
  amenityChecks,
}: CompletionProgress): string {
  return `${plural(menuItems, "menu item", "menu items")} · ${plural(amenityChecks, "amenity check", "amenity checks")}`
}

// ---------------------------------------------------------------------------
// Goal-led Home and its parts (goals-not-tasks G-1 to G-4, moved here by G-5).
// Food and drink work is a shared goal: these never say task, due or overdue.

/** Home's read failures: each says what couldn't be checked, never "none". */
export const HOME_READ_FAILED = {
  notes: "We couldn't check requests for another photo.",
  otherJobs: "We couldn't check your other jobs.",
  review: "We couldn't check photos to review.",
  labels: "We couldn't check which photos need labels.",
  rechecks: "We couldn't check your rechecks.",
} as const

/** Our menu on goal-led Home (v0.5 §1). */
export const HOME_OUR_MENU_COPY = {
  title: "Our menu",
  subtitle: (venue: string | null) =>
    `The whole team's goal${venue ? ` at ${venue}` : ""}: an accepted photo of every dish and drink`,
  count: (covered: number, total: number) =>
    `${covered} of ${total} have an accepted photo`,
  recheck: (n: number) =>
    n === 1
      ? "1 dish is being checked after a menu change."
      : `${n} dishes are being checked after a menu change.`,
  stillNeeded: "Still needed",
  stillNeededHint:
    "Anyone can take these. A dish leaves the list once a photo of it is accepted.",
  listFailed: "The dishes still needed can't be shown right now.",
  seeAll: (n: number) => `See all ${n}`,
  complete: "Every dish and drink on the menu has an accepted photo.",
  completeHint: "New photos still count toward your month.",
  empty: "The active menu has no dishes or drinks yet.",
  needsSetup:
    "Your venue's menu appears here once an admin assigns your venue.",
  unavailable: "Menu photos can't be shown right now. Try again later.",
  browse: "Browse our menu",
} as const

/** Your month on goal-led Home (v0.5 §1; decision 13). */
export const HOME_MONTH_COPY = {
  title: "Your month",
  /** Decision 5 as amended by G-9 (decision 24): what earns month credit. */
  counts:
    "Accepted photos you labelled — dishes, drinks and venue areas — and photos you sent to the month, count",
  private: "Only you, your manager and admins see this.",
  noTarget: "There's no photo target for you this month.",
  seeMonth: "See your month",
} as const

/** The month page's photo list (G-2). */
export const MONTH_PHOTOS_COPY = {
  heading: (month: string, combined: boolean) =>
    `${combined ? "Coverage photos" : "Photos"} in ${month}`,
  empty: "No photos count toward this month yet.",
  taken: (date: string) => `Taken ${date}`,
  monthlyPhoto: "Monthly photo",
} as const

/** Decision 10: the one row and list for jobs that aren't menu photos. */
export const OTHER_JOBS_COPY = {
  title: "Other jobs",
  body: "Checks and venue jobs that aren't menu photos.",
  countLabel: "jobs",
  summary: "Overdue jobs still take photos.",
  rechecks: "Checks to do again",
} as const

/** A menu section's send page, served only to answer a request (G-4). */
export const SECTION_SEND_COPY = {
  heading: "Your photos for this section",
  empty: "You haven't sent photos for this section yet.",
} as const

/** Decision 19: the person's own photo work, as compact rows on Home. */
export const OWN_WORK_COPY = {
  labels: (n: number) =>
    `${plural(n, "photo needs", "photos need")} a dish or drink label`,
  labelAttention: (n: number) =>
    `${plural(n, "label save needs", "label saves need")} attention`,
  labelAction: "Label these",
  failed: (n: number) =>
    `${plural(n, "photo didn't", "photos didn't")} finish saving on this phone`,
  failedAction: "See them",
} as const

/** The retake note block (G-3; decisions 4, 12 and 14). */
export const RETAKE_COPY = {
  heading: "Needs another photo",
  reshoot: "Reshoot",
  choose: "Choose from photos",
  later: "Later",
  again: "Take another",
  sent: "New photo sent · waiting for review",
  setAside: "Set aside for later. It stays here until a new photo is accepted.",
  monthPhoto: "Photo for your month",
  noReason: "Your reviewer didn't leave a reason.",
  offMenu:
    "This dish isn't on your venue's menu now, so a new photo can't be sent for it.",
  closed: "This is no longer open to you, so no new photo is needed.",
  laterFailed: "We couldn't set this aside. Try again.",
  meIntro:
    "A reviewer would like another photo. Take a new one and it goes to them for review.",
  listLabel: "Photos that need another photo",
} as const
