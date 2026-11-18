/**
 * S3-R5 (K3): staff reports of a changed slot or a wrong photo detail, as the
 * venue's manager sees them on Venue › Reported changes (spec §6 S3, S4,
 * §7 M5). Pure and client-safe. The report model and the reason words are
 * S2-STAFF's (lib/staff/slot-reports.ts); this adds where each report's
 * subject is changed and the check on a manager's decision.
 */

import type { SlotReport, SlotReportKind } from "@/lib/staff/slot-reports"

export type SlotReportDecision = "resolved" | "dismissed"

/** The kind of thing a report is about, in the manager's words. */
export const REPORT_KIND_WORDS: Record<SlotReportKind, string> = {
  dish: "Dish",
  area: "Space",
  amenity: "Facility",
  photo: "Photo",
}

/** Where the manager changes what a report is about. */
export function reportSubjectHref(
  report: Pick<SlotReport, "subjectKind" | "subjectId">
): string {
  const id = encodeURIComponent(report.subjectId)
  switch (report.subjectKind) {
    case "dish":
      return `/manager/menu/${id}`
    case "amenity":
      return `/manager/amenities/${id}`
    case "area":
      return "/manager/amenities/places"
    case "photo":
      return `/manager/review/photo/${id}`
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const DECISION_NOTE_MAX = 500

/**
 * A decision from the page (untrusted): a report id, resolved or dismissed,
 * and an optional note of up to 500 characters. Null when malformed.
 */
export function parseReportDecision(input: unknown): {
  reportId: string
  action: SlotReportDecision
  note?: string
} | null {
  if (input === null || typeof input !== "object") return null
  const i = input as Record<string, unknown>
  if (typeof i.reportId !== "string" || !UUID.test(i.reportId)) return null
  if (i.action !== "resolved" && i.action !== "dismissed") return null
  if (i.note !== undefined && i.note !== null && typeof i.note !== "string")
    return null
  const note = typeof i.note === "string" ? i.note.trim() : ""
  if ([...note].length > DECISION_NOTE_MAX) return null
  return {
    reportId: i.reportId,
    action: i.action,
    ...(note ? { note } : {}),
  }
}
