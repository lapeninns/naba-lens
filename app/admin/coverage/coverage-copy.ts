import { plural } from "@/components/nabalens/coverage/copy"

const names = new Intl.ListFormat("en-GB", {
  style: "long",
  type: "conjunction",
})

/** "The Bell and The White Horse"; "all venues" when nobody is named. */
export function venueList(list: string[]): string {
  return list.length ? names.format(list) : "all venues"
}

/** "November" from "November 2026". */
export function monthName(periodLabel: string): string {
  return periodLabel.split(" ")[0] ?? periodLabel
}

export const COVERAGE_COPY = {
  title: "Coverage",
  allVenues: "All venues",
  summary:
    "Each venue's checklist and its staff's monthly targets, counted separately.",
  pastSummary: (month: string) =>
    `${month} is read-only. Only admins can correct a past month, with a reason.`,
  venueManagers: "Venue managers",
  venueCoverage: "Venue coverage",
  staffParticipation: "Staff participation",
  venues: "Venues",
  venuesNote: (count: number) =>
    `${plural(count, "venue")} · a venue is complete when every applicable item is and its menu coverage is current`,
  selfReviews: "Self-reviews",
  selfReviewsNote:
    "Managers who reviewed their own photos. Allowed and recorded.",
  selfReviewsThisMonth: (count: number) =>
    count === 0 ? "None this month" : `${count} this month`,
  emptyTitle: "No active venues yet.",
  emptyText: "Coverage appears once a venue is active and has staff.",
  loading: "Loading coverage…",
  couldNotLoad: "We couldn't load coverage",
  month: "Month",
  previousMonth: (label: string) => `Previous month, ${label}`,
  nextMonth: (label: string) => `Next month, ${label}`,
  nextNotStarted: "Next month (not started)",
  unpreparedTitle: (count: number) =>
    count === 1
      ? "1 venue isn't prepared yet"
      : `${count} venues aren't prepared yet`,
  unpreparedBody: (venues: string[], month: string) =>
    `${venueList(venues)} ${venues.length === 1 ? "hasn't" : "haven't"} been prepared for ${month}. It runs every hour; you can run it now.`,
  tally: {
    venuesComplete: "Venues complete",
    needSetup: "Need setup",
    acrossVenues: (count: number) => `Across ${plural(count, "venue")}`,
    toReview: "To review",
    overdue: "Overdue",
    menuChanged: "Menu changed",
    metTarget: "Met their target",
    photosAccepted: "Photos accepted",
    withoutTarget: (count: number) => `${count} without a target`,
  },
  chip: {
    needSetup: (count: number) => `${count} need setup`,
    toReview: (count: number) => `${count} to review`,
    overdue: (count: number) => `${count} overdue`,
  },
  itemsComplete: (total: number) => `of ${total} items complete`,
  metTheirTarget: (total: number) => `of ${total} met their target`,
} as const

export const PREPARATION_COPY = {
  title: "Monthly preparation",
  summary:
    "Copies last month's targets and checklist items into the new month for every venue. It runs every hour and is safe to repeat.",
  prepareThisMonth: "Prepare this month",
  prepareAgain: "Prepare again",
  preparing: "Preparing…",
  tryAgain: "Try again",
  venues: "Venues",
  venuesNote: "Need setup: active staff with no target, team or venue",
  venuesTable: "Preparation by venue",
  recentRuns: "Recent runs",
  recentRunsNote: "Last 7 days · runs that prepared a venue or failed",
  noRecentRuns: (since: string) =>
    `No runs have prepared anything since ${since}.`,
  columns: {
    venue: "Venue",
    targetsCopied: "Targets copied",
    needSetup: "Need setup",
    when: "When",
    startedBy: "Started by",
    result: "Result",
  },
  hourly: "Hourly",
  manual: "Manual",
  notPrepared: "Not prepared yet",
  didntFinish: "Didn't finish",
  prepared: (at: string | null) => (at ? `Prepared ${at}` : "Prepared"),
  unpreparedBody: (venues: string[], month: string) =>
    `${venueList(venues)} ${venues.length === 1 ? "hasn't" : "haven't"} been prepared for ${month}. Until ${venues.length === 1 ? "it is" : "they are"}, their staff targets show Needs setup.`,
  preparingTitle: "Preparing",
  preparingBody: (month: string, venues: string[]) =>
    `Preparing ${month} for ${venueList(venues)}. You can leave this page; it carries on.`,
  failedTitle: (count: number) =>
    count === 1 ? "1 venue didn't finish" : `${count} venues didn't finish`,
  safeToRepeat: "It's safe to repeat.",
  firstRun: (nextRun: string) =>
    `No successful run this month. The next hourly run is at ${nextRun}, or prepare now.`,
  summaryLine: (prepared: number, total: number, lastRun: string | null) =>
    [
      `Prepared for ${prepared} of ${plural(total, "venue")}`,
      lastRun ? `last run ${lastRun}` : null,
      "runs every hour",
    ]
      .filter(Boolean)
      .join(" · "),
  venuesPrepared: (venues: string[]) =>
    `${plural(venues.length, "venue")} prepared: ${venues.join(", ")}`,
  needSetupDetail: (count: number, why: string | null) =>
    why && count > 0 ? `${count} · ${why}` : String(count),
  noTarget: "no target",
  targetNotCopied: "target not copied",
  allVenuesScope: "All venues",
  // Not in the copy deck yet: A17 has no way into the full run history.
  seeAllRuns: "See all runs",
} as const

/*
 * Run failures store a SQLSTATE only. Serialisation and uniqueness failures
 * mean another write touched a target mid-run; anything else stopped the run.
 */
const CONFLICT_CODES = new Set(["23505", "40001", "40P01", "55P03"])

/** What went wrong, in plain words, without the code. */
export function failureWords(errorCode: string | null): string {
  return errorCode && CONFLICT_CODES.has(errorCode)
    ? "a target was changed while preparing. Run it again."
    : "preparation stopped before it finished. Run it again."
}

/** The code shown after the words: the deck's name for a conflict, else the SQLSTATE. */
export function failureCode(errorCode: string): string {
  return CONFLICT_CODES.has(errorCode) ? "PREP_TARGET_CONFLICT" : errorCode
}

/** A18: one venue's coverage inside the admin shell. */
export const VENUE_COVERAGE_COPY = {
  title: "Venue coverage",
  loading: "Loading venue coverage…",
  couldNotLoad: "We couldn't load this venue's coverage",
  notFoundTitle: "We couldn't find that venue",
  notFoundText: "It may have been removed, or the link may be wrong.",
  backToVenues: "All venues",
} as const

/** A19: managers' decisions on their own photos. */
export const SELF_REVIEWS_COPY = {
  title: "Self-reviews",
  body: "Decisions venue managers made on their own photos. Self-review is allowed; it's recorded here so admins can see it.",
  emptyTitle: (periodLabel: string) => `No self-reviews in ${periodLabel}.`,
  emptyText: "When a manager reviews their own photo, it's listed here.",
} as const
