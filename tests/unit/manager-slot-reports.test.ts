// S3-R5 (K3): Venue › Reported changes. Where a report's subject is changed,
// and the check on a manager's decision before it reaches the database.
import { describe, expect, it } from "vitest"

import {
  parseReportDecision,
  REPORT_KIND_WORDS,
  reportSubjectHref,
} from "@/lib/manager/slot-reports"
import { historyActionWords } from "@/lib/manager/venue"

const ID = "6a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d"

describe("reportSubjectHref", () => {
  it("opens the dish, facility, spaces or photo the report is about", () => {
    expect(reportSubjectHref({ subjectKind: "dish", subjectId: ID })).toBe(
      `/manager/menu/${ID}`
    )
    expect(reportSubjectHref({ subjectKind: "amenity", subjectId: ID })).toBe(
      `/manager/amenities/${ID}`
    )
    expect(reportSubjectHref({ subjectKind: "area", subjectId: ID })).toBe(
      "/manager/amenities/places"
    )
    expect(reportSubjectHref({ subjectKind: "photo", subjectId: ID })).toBe(
      `/manager/review/photo/${ID}`
    )
    expect(reportSubjectHref({ subjectKind: "dish", subjectId: "a/b?c" })).toBe(
      "/manager/menu/a%2Fb%3Fc"
    )
  })

  it("has words for every kind", () => {
    expect(Object.keys(REPORT_KIND_WORDS).sort()).toEqual([
      "amenity",
      "area",
      "dish",
      "photo",
    ])
  })
})

describe("parseReportDecision", () => {
  it("accepts a report id, a decision and an optional trimmed note", () => {
    expect(parseReportDecision({ reportId: ID, action: "resolved" })).toEqual({
      reportId: ID,
      action: "resolved",
    })
    expect(
      parseReportDecision({
        reportId: ID,
        action: "dismissed",
        note: "  Still served on Sundays ",
      })
    ).toEqual({
      reportId: ID,
      action: "dismissed",
      note: "Still served on Sundays",
    })
    expect(
      parseReportDecision({ reportId: ID, action: "resolved", note: "   " })
    ).toEqual({ reportId: ID, action: "resolved" })
  })

  it("refuses anything else", () => {
    for (const bad of [
      null,
      "x",
      {},
      { reportId: "x", action: "resolved" },
      { reportId: ID, action: "withdrawn" },
      { reportId: ID, action: "open" },
      { reportId: ID, action: "resolved", note: 3 },
      { reportId: ID, action: "resolved", note: "x".repeat(501) },
    ])
      expect(parseReportDecision(bad)).toBeNull()
  })
})

describe("history words", () => {
  it("names report events in History", () => {
    expect(historyActionWords("slot_change_reported")).toBe(
      "Change reported by staff"
    )
    expect(historyActionWords("slot_change_resolved")).toBe(
      "Reported change dealt with"
    )
    expect(historyActionWords("slot_change_dismissed")).toBe(
      "Reported change dismissed"
    )
  })
})
