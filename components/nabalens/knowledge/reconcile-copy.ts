// Admin reconciliation words (B03 UI design §7.3, §7.4).

import type {
  MappingKind,
  ReconcileProposal,
  SourceKind,
} from "@/lib/knowledge-client/contract"

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  venue_website: "Venue website",
  google_business_profile: "Business profile",
  booking_site: "Booking site",
  operator_document: "Operator document",
  other: "Other",
}

export const MAPPING_KIND_LABEL: Record<MappingKind, string> = {
  exact: "Exact",
  candidate: "Candidate",
  none: "None",
}

export const RECONCILE_COPY = {
  sourcesTitle: "Sources and mappings",
  sources: "Sources",
  allVenues: "All venues",
  declared: (date: string, by: string) => `Declared on ${date} by ${by}`,
  retired: (date: string) => `Retired on ${date}`,
  noSources: "No sources declared.",
  declare: "Declare a source",
  declareHelp: "Declare only sources the owner has agreed to use.",
  kind: "Kind",
  label: "Label",
  venue: "Venue (optional)",
  declareSubmit: "Declare source",
  declared_: "Source declared.",
  retire: "Retire",
  retireTitle: (label: string) => `Retire ${label}?`,
  why: "Why?",
  whyEmpty: "Say why.",
  retireConfirm: "Retire source",
  retiredDone: "Source retired.",
  mappings: "Mappings",
  mappingsLine: "Latest review in force. Not checked old facts create nothing.",
  noMappings: "No old facts to map.",
  review: "Review",
  reviewTitle: (key: string) => `Review ${key}`,
  question: "Question",
  mappingKind: "Mapping",
  exactHelp:
    "Exact means the old fact means the same as the question. Broad facts never establish a narrower question.",
  reason: "Reason",
  reasonEmpty: "Say why.",
  reviewSubmit: "Save review",
  reviewed: "Review saved.",
  latest: (kind: string, reason: string, by: string, date: string) =>
    `${kind}: ${reason} (${by}, ${date})`,
  presence: {
    present: "Present",
    absent: "Absent",
    unknown: "Not checked",
  } as const,
  showOlder: "Show more",
  runsTitle: "Runs",
  runs: "Runs",
  noRuns: "No runs yet.",
  runKind: { legacy: "Old facts", external: "Other sources" } as const,
  runMode: { dry_run: "Dry run", apply: "Applied" } as const,
  started: (by: string, at: string) => `Started by ${by}, ${at}`,
  start: "Start a dry run",
  startSubmit: "Start dry run",
  scopeVenue: "Venue",
  allOfThem: "All venues",
  running: "Running…",
  stillRunning:
    "Still running; you can leave this page. Its results appear here.",
  summary: (c: {
    proposals: number
    skipped: number
    conflicting: number
    corroborating: number
  }) =>
    `${c.proposals} would be imported for managers to decide · ${c.skipped} skipped · ${c.conflicting} disagree with what's recorded · ${c.corroborating} agree and would be recorded as seen`,
  wouldCreate: "Would be imported",
  conflicts: "Disagree with what's recorded",
  revisions: "Source versions read",
  noneListed: "None.",
  proposal: (
    p: Pick<ReconcileProposal, "questionKey" | "answer" | "source">,
    venue: string
  ) => `${venue}: ${p.questionKey}, ${p.answer} (${p.source})`,
  apply: (n: number) => `Import ${n} for managers to decide`,
  applyTitle: (n: number) => `Import ${n}?`,
  applyBody:
    "Managers decide each one. Nothing becomes an answer by itself, and nothing replaces an answer in use.",
  applyConfirm: "Import",
  applied: (created: number, already: number) =>
    `Imported ${created}. ${already} ${already === 1 ? "was" : "were"} already there.`,
  applyStale: "A dry run under 24 hours old is needed before importing.",
  lostApply:
    "We couldn't confirm the run started. Check the runs list before starting again; nothing is imported twice.",
  newDryRun: "Start a new dry run",
  cancel: "Cancel",
  failed: "This couldn't be read.",
  tryAgain: "Try again",
  aVenue: "A venue",
  someone: "an admin",
} as const

/** A dry run may be applied for 24 hours (§7.4). */
export const DRY_RUN_FRESH_MS = 24 * 60 * 60 * 1000
