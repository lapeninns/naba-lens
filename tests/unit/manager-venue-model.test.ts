// S2-MGR: the manager Overview model and the venue parsers (spec §7 M1, M5,
// §9.3). Pure functions; the database side is tests/security/manager-venue.
import { describe, expect, it } from "vitest"

import type { CoverageView } from "@/lib/album/model"
import type {
  FactCoverageView,
  FactStateView,
  SpacePhotoFreshnessRow,
} from "@/lib/knowledge/facts"
import {
  backlogSplit,
  categoryRows,
  factsAwaiting,
  overviewActions,
  type OverviewInput,
} from "@/lib/manager/overview"
import { factsToConfirm, spacesToConfirm } from "@/lib/manager/to-confirm"
import {
  historyActionWords,
  isHistorySource,
  parseCursor,
  parseMenuCheck,
  parseReviewers,
  parseVenueHistory,
  parseVenueSummary,
} from "@/lib/manager/venue"

const counts = (total: number, covered: number, extra: object = {}) => ({
  total,
  covered,
  checkDue: 0,
  pending: 0,
  replacementNeeded: 0,
  missing: total - covered,
  notHere: 0,
  inactive: 0,
  unavailable: 0,
  ...extra,
})

const COVERAGE: CoverageView = {
  venueId: "v",
  slots: [],
  categories: [
    { category: "food", ...counts(4, 3) },
    { category: "drinks", ...counts(2, 1) },
    { category: "spaces", ...counts(3, 0) },
    { category: "facilities", ...counts(0, 0) },
    { category: "other", ...counts(0, 0) },
  ],
  totals: counts(9, 4, {
    missing: 3,
    pending: 2,
    checkDue: 1,
    replacementNeeded: 1,
  }),
}

const FACTS: FactCoverageView = {
  venueId: "v",
  numerator: 5,
  denominator: 6,
  checkDue: 1,
  unconfirmed: 2,
  withdrawn: 0,
  publicNumerator: 5,
  byCategory: [],
}

const HREFS = {
  review: "/r",
  unlabelled: "/r?status=unlabelled",
  venue: "/v",
  requests: "/q",
  exports: "/e",
}

const input = (over: Partial<OverviewInput> = {}): OverviewInput => ({
  now: "2026-11-18T12:00:00Z",
  pendingPhotos: 50,
  oldestPendingAt: "2026-11-15T12:00:00Z",
  unlabelledPhotos: 4,
  coverage: COVERAGE,
  facts: FACTS,
  publicationIssues: 2,
  menuCheckDue: true,
  ...over,
})

describe("overviewActions (spec §7 M1)", () => {
  it("lists the four actions in the spec's order with their counts", () => {
    const actions = overviewActions(input(), HREFS)
    expect(actions.map((a) => [a.key, a.title])).toEqual([
      ["review", "Review photos"],
      ["venue", "Check venue details"],
      ["request", "Ask for missing photos"],
      ["outdated", "Resolve outdated public content"],
    ])
    expect(actions[0]).toMatchObject({
      line: "50 photos waiting · oldest 3 days · 4 need a label",
      href: "/r",
      waiting: true,
    })
    expect(actions[1]).toMatchObject({
      line: "3 facts awaiting confirmation · this month's menu check is due",
      href: "/v",
      waiting: true,
    })
    expect(actions[2]).toMatchObject({
      line: "3 slots still empty · 1 need replacing",
      href: "/q",
    })
    expect(actions[3]).toMatchObject({
      line: "2 publication issues · 1 needs checking",
      href: "/e",
    })
  })

  it("says what is quiet, and sends unlabelled-only work to the Needs labels filter", () => {
    const quiet = overviewActions(
      input({
        pendingPhotos: 0,
        unlabelledPhotos: 1,
        facts: { ...FACTS, checkDue: 0, unconfirmed: 0 },
        menuCheckDue: false,
        publicationIssues: 0,
        coverage: {
          ...COVERAGE,
          totals: counts(9, 9, { missing: 0 }),
        },
      }),
      HREFS
    )
    expect(quiet[0]).toMatchObject({
      line: "Nothing waiting for review · 1 needs a label",
      href: "/r?status=unlabelled",
    })
    expect(quiet[1]).toMatchObject({ line: "Facts confirmed", waiting: false })
    expect(quiet[2]).toMatchObject({ line: "No empty slots", waiting: false })
    expect(quiet[3]).toMatchObject({
      line: "No publication issues",
      href: "/v",
      waiting: false,
    })
  })

  it("never shows an unread count as zero", () => {
    const unread = overviewActions(
      input({
        pendingPhotos: null,
        unlabelledPhotos: null,
        coverage: null,
        facts: null,
        publicationIssues: null,
        menuCheckDue: null,
      }),
      HREFS
    )
    for (const action of unread) expect(action.line).toMatch(/couldn't count/)
    expect(unread.every((a) => !a.waiting)).toBe(true)
  })
})

describe("backlogSplit: collection and review stay apart", () => {
  it("counts empty slots separately from photos waiting", () => {
    expect(backlogSplit(input())).toEqual({
      toCollect: 3,
      slotsWaiting: 2,
      photosWaiting: 50,
    })
    expect(
      backlogSplit(input({ coverage: null, pendingPhotos: null }))
    ).toEqual({ toCollect: null, slotsWaiting: null, photosWaiting: null })
  })
})

describe("categoryRows (FA-8: n of N, percentage secondary)", () => {
  it("shows food, drinks, spaces and facilities, Other only when present, then facts", () => {
    const rows = categoryRows(COVERAGE, FACTS)
    expect(rows.map((r) => [r.key, r.text, r.percent])).toEqual([
      ["food", "3 of 4", "75%"],
      ["drinks", "1 of 2", "50%"],
      ["spaces", "0 of 3", "0%"],
      ["facilities", "0 of 0", ""],
      ["facts", "5 of 6", "83.3%"],
    ])
    const withOther = categoryRows(
      {
        ...COVERAGE,
        categories: [{ category: "other", ...counts(2, 1) }],
      },
      null
    )
    expect(withOther.find((r) => r.key === "other")?.text).toBe("1 of 2")
    expect(categoryRows(null, null)).toEqual([])
  })

  it("counts facts awaiting confirmation as Unconfirmed plus Check due", () => {
    expect(factsAwaiting(FACTS)).toBe(3)
    expect(factsAwaiting(null)).toBeNull()
  })
})

describe("venue parsers", () => {
  it("reads reviewers and drops malformed candidates", () => {
    expect(
      parseReviewers({
        venueId: "v",
        main: { profileId: "p1", name: "Maya", since: "2026-11-18" },
        backup: null,
        candidates: [{ profileId: "p1", name: "Maya" }, { name: "x" }],
      })
    ).toEqual({
      venueId: "v",
      main: { profileId: "p1", name: "Maya", since: "2026-11-18" },
      backup: null,
      candidates: [{ profileId: "p1", name: "Maya" }],
    })
    expect(parseReviewers({ venueId: "v" })).toBeNull()
    expect(parseReviewers(null)).toBeNull()
  })

  it("reads the venue summary and the month's menu check", () => {
    const summary = parseVenueSummary({
      venueId: "v",
      unlabelledPhotos: 3,
      menuCheck: {
        month: "2026-11-01",
        menuVersionId: "m",
        menuTitle: "Autumn",
        due: false,
        confirmedAt: "2026-11-02T10:00:00Z",
        confirmedBy: "Maya",
      },
      reviewers: { main: null, backup: { profileId: "p2", name: "Sam" } },
    })
    expect(summary).toMatchObject({
      unlabelledPhotos: 3,
      menuCheck: { due: false, confirmedBy: "Maya" },
      reviewers: { main: null, backup: { profileId: "p2", since: null } },
    })
    expect(
      parseVenueSummary({ venueId: "v", unlabelledPhotos: -1, reviewers: {} })
    ).toBeNull()
    expect(parseMenuCheck(null)).toBeNull()
    expect(
      parseMenuCheck({ month: "2026-11-01", menuVersionId: "m" })
    ).toBeNull()
  })

  it("reads history pages and their cursor", () => {
    const page = parseVenueHistory({
      venueId: "v",
      items: [
        {
          source: "activity",
          id: 7,
          at: "2026-11-18T10:00:00Z",
          action: "reviewer_assigned",
          actorName: "Maya",
          actorRole: "manager",
          objectType: "venue_reviewer",
          objectId: null,
          reason: null,
        },
        { source: "x" },
      ],
      nextCursor: { at: "2026-11-18T10:00:00Z", source: "activity", id: 7 },
    })
    expect(page?.items).toHaveLength(1)
    expect(page?.items[0]).toMatchObject({ id: "7", actorName: "Maya" })
    expect(page?.nextCursor).toEqual({
      at: "2026-11-18T10:00:00Z",
      source: "activity",
      id: "7",
    })
    expect(parseCursor({ at: "x" })).toBeNull()
    expect(parseVenueHistory({ venueId: "v" })).toBeNull()
  })

  it("words history actions, known and unknown", () => {
    expect(historyActionWords("reviewer_assigned")).toBe("Reviewer nominated")
    expect(historyActionWords("applicability_removed")).toBe("Marked not here")
    expect(historyActionWords("something_new")).toBe("Something new")
    expect(isHistorySource("activity")).toBe(true)
    expect(isHistorySource("nope")).toBe(false)
  })
})

describe("To confirm lists (spec §9.3)", () => {
  const fact = (over: Partial<FactStateView>): FactStateView =>
    ({
      key: "k",
      category: "Access",
      question: "Is there step-free access?",
      checkId: "c1",
      applicable: true,
      verification: "check_due",
      publicVerification: "check_due",
      answer: "yes",
      valueInUse: null,
      reason: null,
      detail: null,
      conditions: null,
      limitations: null,
      sourceType: null,
      confirmationBasis: null,
      verifiedOn: "2026-08-12",
      nextCheckDue: null,
      nextCheckSetBy: null,
      publicNextCheckDue: null,
      revision: 4,
      questionVersion: 1,
      valueSchema: null,
      submissionId: null,
      ...over,
    }) as FactStateView

  it("lists unconfirmed and check-due facts; only a recorded answer can be reconfirmed", () => {
    const items = factsToConfirm(
      [
        fact({}),
        fact({ checkId: "c2", verification: "confirmed" }),
        fact({
          checkId: "c3",
          verification: "unconfirmed",
          answer: null,
          verifiedOn: null,
        }),
      ],
      (id) => `/check/${id}`
    )
    expect(items.map((i) => i.id)).toEqual(["fact:c1", "fact:c3"])
    expect(items[0]).toMatchObject({
      lines: ["Check due · Answer: Yes", "Last checked 12 Aug 2026"],
      payload: { checkId: "c1", slotRevision: 4 },
      href: "/check/c1",
    })
    expect(items[1]).toMatchObject({
      lines: [
        "Unconfirmed · No answer yet",
        "Answer it on the question's page",
      ],
      payload: null,
    })
  })

  it("groups space photos due a check by place", () => {
    const row = (over: Partial<SpacePhotoFreshnessRow>) =>
      ({
        label_id: "l",
        asset_id: "a",
        subject_id: "s1",
        subject_kind: "area",
        subject_label: "Garden",
        state: "check_due",
        cause: "review_date_passed",
        reason: null,
        verified_on: "2026-08-01",
        next_check_due: null,
        due_soon: false,
        valid_until: null,
        ...over,
      }) as SpacePhotoFreshnessRow
    const items = spacesToConfirm(
      [
        row({}),
        row({ label_id: "l2" }),
        row({ subject_id: "s2", state: "current" }),
      ],
      "/places"
    )
    expect(items).toEqual([
      {
        id: "space:s1",
        title: "Garden",
        lines: ["2 photos due a check", "Last checked 1 Aug 2026"],
        payload: { subjectId: "s1" },
        href: "/places",
        thumb: "/api/media/a/thumb",
      },
    ])
  })
})
