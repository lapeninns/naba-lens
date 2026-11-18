// Words for the manager and admin metrics screens (spec §18; FA-7, FA-8).
// British English, sentence case (DESIGN.md §7). Managers and admins may see
// the spec's names; nobody is named or ranked. A slot state's word is its
// coverage_* chip (status-chip.tsx), read here, never typed again (X11).

import { CHIP_STATES } from "@/components/nabalens/status-chip"

const SLOT = {
  covered: CHIP_STATES.coverage_covered.word,
  checkDue: CHIP_STATES.coverage_check_due.word,
  pending: CHIP_STATES.coverage_pending.word,
  replacement: CHIP_STATES.coverage_replacement_needed.word,
  missing: CHIP_STATES.coverage_missing.word,
  notHere: CHIP_STATES.coverage_not_here.word,
  inactive: CHIP_STATES.coverage_inactive.word,
} as const

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

export const METRICS_COPY = {
  title: "Metrics",
  loading: "Loading the metrics",
  what: "the metrics",
  summary:
    "How complete the venue's photos and facts are, how review is going, and how the photos are used. Every number shows what it counts.",
  adminSummary:
    "Each venue's coverage, facts, review and reliability. Choose a venue to see how each number is counted.",
  entry: "Metrics",
  entryNote: "Coverage by category, review and how photos are used",
  periodLabel: "Period",
  period: (days: number) => `Last ${days} days`,
  categoryLabel: "Category",
  allCategories: "All",
  inPeriod: (days: number) => `last ${days} days`,
  oldest: (age: string) => `oldest ${age}`,
  generated: (when: string) => `Counted on ${when}.`,

  attentionTitle: "Needs attention",
  missing: SLOT.missing,
  missingNote: (retakes: number) =>
    retakes > 0
      ? `${plural(retakes, "retake", "retakes")} asked for`
      : "slots with no photo",
  awaitingReview: SLOT.pending,
  needsLabel: "Needs label",
  needsLabelNote: (inQueue: number) =>
    inQueue > 0 ? `${inQueue} waiting over 7 days` : "photos without a slot",
  checkDue: SLOT.checkDue,
  factsDue: (n: number) =>
    n > 0 ? `${plural(n, "fact", "facts")} to confirm` : "no facts to confirm",
  technicalFailures: "Technical failures",

  coverageTitle: "Photo coverage",
  coverageRule: `${SLOT.covered} means a current photo accepted for public use. A reference photo, an extra photo or a duplicate never adds to it. ${SLOT.notHere} and ${SLOT.inactive} leave the total; a dish that is sold out stays in it.`,
  category: "Category",
  covered: SLOT.covered,
  anotherPhoto: SLOT.replacement,
  notCounted: "Not counted",
  unavailable: (n: number) =>
    `${plural(n, "slot is", "slots are")} temporarily unavailable and still counted.`,

  completenessTitle: "Items and facts",
  itemsIn: (category: string) => `${category}: complete`,
  factsConfirmed: "Facts confirmed",
  nothingCounted: "nothing to count yet",
  itemRule:
    "An item is complete when every photo it needs is covered. A facility is complete when its answer is currently confirmed and, where a photo is needed, the photo is covered. A confirmed No counts.",

  reviewTitle: "Review",
  reviewMedian: "Decisions",
  decidedNote: (median: string, p90: string) =>
    `typical wait ${median} · 9 in 10 within ${p90}`,
  processingMedian: "Uploads processed",
  processedNote: (median: string) => `typical processing ${median}`,
  labelCorrections: "Labels corrected",
  labelledByReviewer: "Labelled by a reviewer",
  kindLine: (n: number, median: string) =>
    `${plural(n, "decision", "decisions")} · typical wait ${median}`,
  reviewRule:
    "Review wait runs from when a photo was ready and labelled to its first decision. Processing time is counted separately. Label corrections are dish photos given another dish by the reviewer, by how the photo was added.",

  useTitle: "Contributions and use",
  useful: "Useful contributions",
  usefulNote: (first: number, replacement: number) =>
    `${first} filled a gap · ${replacement} replaced an old photo`,
  extra: "Extra photos",
  extraNote: (duplicates: number) =>
    duplicates > 0
      ? `${plural(duplicates, "duplicate", "duplicates")} not counted`
      : "beside a current photo",
  exports: "Exports downloaded",
  exportsNote: (packages: number, files: number) =>
    `${plural(packages, "package", "packages")} made · ${plural(files, "file", "files")}`,
  publications: "Publications recorded",
  publicationsNote: (assets: number, withdrawn: number) =>
    `${plural(assets, "photo", "photos")} · ${withdrawn} withdrawn`,
  usefulRule:
    "A useful contribution is the first photo accepted for public use on a slot, or one accepted to replace a photo no longer current. Exports and publications are counted separately.",

  reliabilityTitle: "Reliability",
  uploadsNote: (n: number) => `of ${plural(n, "upload", "uploads")} started`,
  editorial: "Retakes asked for",
  editorialNote: "editorial, not technical",
  failedUploads: "Uploads that failed",
  notFinished: "Uploads never finished",
  stuck: "Stuck in processing now",
  exportFailures: "Export downloads that failed",
  destinationFailures: "Publications that failed",
  clientFailures: "Sending failures seen on phones",
  clientRetries: "Sent again after a failure",
  recovered: "Recovered after a failure",

  howCountedTitle: "How this is counted",
  reproduced: (covered: number, total: number) =>
    `Counting the slots below gives ${covered} of ${total} covered.`,
  counted: "counted",
  leavesTotal: "not in the total",
  soldOut: "temporarily unavailable",
  noSlotsTitle: "No slots yet",
  noSlots: "Slots appear once the venue has a menu, spaces or facilities.",

  flowTitle: "How photos are added",
  noFlow: "Nothing recorded in this period.",
  flowRule:
    "Counts of steps in Add photos and Match. Only the step, how it started and counts are recorded: never location, file names or what a photo shows.",

  loadFailedTitle: "Metrics couldn't be loaded",
  loadFailed: "Try again in a moment. Nothing has been changed.",
  venueColumn: "Venue",
  photosColumn: "Photos covered",
  factsColumn: "Facts confirmed",
  waitingColumn: SLOT.pending,
  needsLabelColumn: "Needs label",
  failuresColumn: "Technical failures",
  failedJobs: (n: number) =>
    n > 0
      ? `${plural(n, "scheduled job", "scheduled jobs")} failed in this period. See Settings.`
      : null,
  noVenuesTitle: "No active venues",
  noVenues: "Venues appear here once they are active.",
  chooseVenue: "Choose a venue",
  backToAll: "All venues",
} as const
