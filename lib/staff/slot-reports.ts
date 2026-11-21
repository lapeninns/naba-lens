// Report a change (spec §6 S3) and request correction (§6 S4, §23.6):
// what staff can tell a manager, in plain words. Pure and client-safe; the
// database (20261118111100_slot_change_reports.sql) holds the same lists
// and decides. A report never changes public information by itself.

export type SlotReportKind = "dish" | "area" | "amenity" | "photo"

export type SlotReportReason =
  | "no_longer_served"
  | "appearance_changed"
  | "space_unavailable"
  | "wrong_label"
  | "wrong_date"
  | "other"

export type SlotReportState = "open" | "resolved" | "dismissed" | "withdrawn"

export type SlotReport = {
  id: string
  venueId: string
  reporterId: string
  reporterName: string | null
  subjectKind: SlotReportKind
  subjectId: string
  subjectName: string
  reason: SlotReportReason
  note: string | null
  state: SlotReportState
  createdAt: string
  decidedAt: string | null
  decisionNote: string | null
}

/** The spec's short choice on a slot, in its order (§6 S3). */
export const SLOT_REASONS: ReadonlyArray<{
  key: SlotReportReason
  label: string
}> = [
  { key: "no_longer_served", label: "It's no longer served" },
  { key: "appearance_changed", label: "It looks different now" },
  { key: "space_unavailable", label: "The space isn't available" },
  { key: "wrong_label", label: "The name or label is wrong" },
  { key: "other", label: "Something else" },
]

/** A correction on one's own reviewed photo (§6 S4). */
export const PHOTO_REASONS: ReadonlyArray<{
  key: SlotReportReason
  label: string
}> = [
  { key: "wrong_label", label: "It's matched to the wrong slot" },
  { key: "wrong_date", label: "The date it was taken is wrong" },
  { key: "other", label: "Something else" },
]

/** Which reasons a kind of report offers (the database checks the same). */
export function reasonsFor(kind: SlotReportKind) {
  return kind === "photo" ? PHOTO_REASONS : SLOT_REASONS
}

/**
 * The four choices the sheet shows for a kind (screens-2 handoff): a dish
 * leaves out "The space isn't available"; a space has it second, in place
 * of "It's no longer served". The server still accepts every reason in
 * reasonsFor, so a sheet opened before this change still sends.
 */
export function reasonsShown(kind: SlotReportKind) {
  if (kind === "photo") return PHOTO_REASONS
  const skip: SlotReportReason =
    kind === "area" ? "no_longer_served" : "space_unavailable"
  const shown = SLOT_REASONS.filter((r) => r.key !== skip)
  if (kind !== "area") return shown
  // A space: It looks different now, then The space isn't available.
  const order: SlotReportReason[] = [
    "appearance_changed",
    "space_unavailable",
    "wrong_label",
    "other",
  ]
  return order.map((key) => shown.find((r) => r.key === key)!)
}

export const REPORT_NOTE_MAX = 500

export const REPORT_COPY = {
  slotTitle: "Report a change",
  photoTitle: "Ask for a correction",
  slotIntro:
    "Your manager checks it. Nothing on the album or the menu changes until they do.",
  photoIntro:
    "Your manager checks it and corrects it if it's wrong. The photo stays as it is until then.",
  reasonLabel: "What has changed?",
  slotLabel: "Which slot?",
  chooseSlot: "Choose a slot",
  photoReasonLabel: "What is wrong?",
  noteLabel: "Anything to add",
  noteRequired: "Say what has changed.",
  chooseReason: "Choose what has changed.",
  send: "Send to your manager",
  sent: "Sent to your manager. Nothing changes until they check it.",
  alreadySent: "You already told your manager. They haven't checked it yet.",
  failed: "This couldn't be sent. Check your connection and try again.",
} as const

const KINDS = new Set(["dish", "area", "amenity", "photo"])
const REASONS = new Set([
  "no_longer_served",
  "appearance_changed",
  "space_unavailable",
  "wrong_label",
  "wrong_date",
  "other",
])
const STATES = new Set(["open", "resolved", "dismissed", "withdrawn"])

const str = (v: unknown) => (typeof v === "string" ? v : null)

/** One report as the database gives it; null when it is not well formed. */
export function parseSlotReport(raw: unknown): SlotReport | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = str(r.id)
  const venueId = str(r.venueId)
  const reporterId = str(r.reporterId)
  const subjectId = str(r.subjectId)
  const subjectName = str(r.subjectName)
  const createdAt = str(r.createdAt)
  if (
    !id ||
    !venueId ||
    !reporterId ||
    !subjectId ||
    !subjectName ||
    !createdAt ||
    !KINDS.has(r.subjectKind as string) ||
    !REASONS.has(r.reason as string) ||
    !STATES.has(r.state as string)
  )
    return null
  return {
    id,
    venueId,
    reporterId,
    reporterName: str(r.reporterName),
    subjectKind: r.subjectKind as SlotReportKind,
    subjectId,
    subjectName,
    reason: r.reason as SlotReportReason,
    note: str(r.note),
    state: r.state as SlotReportState,
    createdAt,
    decidedAt: str(r.decidedAt),
    decisionNote: str(r.decisionNote),
  }
}

/** A list read ({ items: [...] }) as reports, malformed rows left out. */
export function parseSlotReports(data: unknown): SlotReport[] | null {
  const items = (data as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) return null
  return items.flatMap((row) => {
    const report = parseSlotReport(row)
    return report ? [report] : []
  })
}

/** The words for a reason, whichever list it is on. */
export function reasonWords(reason: SlotReportReason): string {
  return (
    [...SLOT_REASONS, ...PHOTO_REASONS].find((r) => r.key === reason)?.label ??
    reason
  )
}

/**
 * Checks a report before sending it: a reason from the kind's list, and a
 * note for "Something else". Returns the error words, or null when fine.
 */
export function reportProblem(
  kind: SlotReportKind,
  reason: SlotReportReason | null,
  note: string
): string | null {
  if (!reason || !reasonsFor(kind).some((r) => r.key === reason))
    return REPORT_COPY.chooseReason
  const trimmed = note.trim()
  if (reason === "other" && !trimmed) return REPORT_COPY.noteRequired
  if ([...trimmed].length > REPORT_NOTE_MAX)
    return `Write ${REPORT_NOTE_MAX} characters or fewer.`
  return null
}
