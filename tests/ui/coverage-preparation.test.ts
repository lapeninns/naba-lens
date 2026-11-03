import { describe, expect, it, vi } from "vitest"

import {
  failureCode,
  PREPARATION_COPY,
} from "@/app/admin/coverage/coverage-copy"
import {
  buildPreparation,
  failuresFor,
  loadPeriodRuns,
  runsSince,
} from "@/app/admin/coverage/preparation"
import type {
  GroupOverviewRow,
  Page,
  PeriodView,
  PreparationRunView,
  PreparationStatusView,
} from "@/lib/server/coverage/types"

const PERIOD: PeriodView = {
  key: "2026-11",
  label: "November 2026",
  startsAt: "2026-11-01T00:00:00.000Z",
  endsAt: "2026-12-01T00:00:00.000Z",
  isCurrent: true,
  timeZone: "Europe/London",
}

const BELL = { id: "00000000-0000-4000-8000-000000000001", name: "The Bell" }
const HORSE = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "The White Horse",
}

const at = (hoursIntoMonth: number) =>
  new Date(
    Date.parse(PERIOD.startsAt) + hoursIntoMonth * 3_600_000
  ).toISOString()

function run(
  hoursIntoMonth: number,
  o: Partial<PreparationRunView> = {}
): PreparationRunView {
  const finishedAt = at(hoursIntoMonth)
  return {
    id: `run-${String(hoursIntoMonth).padStart(4, "0")}`,
    period: "2026-11",
    venueId: null,
    trigger: "scheduled",
    startedAt: finishedAt,
    finishedAt,
    status: "succeeded",
    staffConsidered: 12,
    targetsCopied: 0,
    placeholdersCreated: 0,
    alreadyPresent: 12,
    candidatesAdded: 0,
    errorCode: null,
    ...o,
  }
}

function row(
  venue: { id: string; name: string },
  o: Partial<GroupOverviewRow> = {}
): GroupOverviewRow {
  return {
    venue,
    managers: [],
    coverage: {
      applicable: 10,
      satisfied: 5,
      needsSetup: 0,
      pendingReview: 0,
      overdue: 0,
      needsReassignment: 0,
      amenityUnknown: 0,
      menuState: "current",
      complete: false,
    },
    participation: {
      staff: 6,
      targetsSet: 6,
      targetsNeedingSetup: 0,
      staffWithoutTarget: 0,
      complete: 2,
      acceptedPhotos: 9,
    },
    selfReviews: 0,
    lastPreparation: null,
    ...o,
  } as GroupOverviewRow
}

/** Hourly runs from `fromHour` to `toHour`, newest first, like the server. */
function hourly(fromHour: number, toHour: number, prepareAt: number) {
  const runs: PreparationRunView[] = []
  for (let h = toHour; h >= fromHour; h--)
    runs.push(
      h === prepareAt
        ? run(h, { targetsCopied: 12, alreadyPresent: 0 })
        : run(h)
    )
  return runs
}

/** Serves `runs` in pages of 24, with an opaque cursor, like listPreparationRuns. */
function pagedLoader(runs: PreparationRunView[]) {
  return vi.fn(
    async (
      cursor: string | null
    ): Promise<{ ok: true } & Page<PreparationRunView>> => {
      const start = cursor ? Number(cursor) : 0
      const items = runs.slice(start, start + 24)
      const next = start + 24
      return {
        ok: true,
        items,
        nextCursor: next < runs.length ? String(next) : null,
      }
    }
  )
}

const STATUS: PreparationStatusView = {
  period: PERIOD,
  lastRunAt: at(58),
  lastStatus: "succeeded",
  lastSuccessAt: at(58),
  lastFailureAt: null,
  lastErrorCode: null,
  staffWithoutTarget: 0,
  targetsNeedingSetup: 0,
}

describe("loadPeriodRuns", () => {
  it("pages past 24 runs until it reaches the start of the month", async () => {
    // 3 Nov 10:00: 59 runs this month, then October's hourly runs.
    const runs = [...hourly(1, 58, 1), ...hourly(-48, -1, -99)]
    const load = pagedLoader(runs)

    const result = await loadPeriodRuns(load, PERIOD.startsAt)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.complete).toBe(true)
    expect(result.runs).toHaveLength(58)
    expect(result.runs.at(-1)?.finishedAt).toBe(at(1))
    expect(result.runs.every((r) => r.finishedAt >= PERIOD.startsAt)).toBe(true)
    // Pages 1–3 hold this month; the third already reaches October.
    expect(load).toHaveBeenCalledTimes(3)
    expect(load.mock.calls.map(([c]) => c)).toEqual([null, "24", "48"])
  })

  it("stops when the list runs out", async () => {
    const load = pagedLoader(hourly(1, 30, 1))
    const result = await loadPeriodRuns(load, PERIOD.startsAt)
    expect(result.ok && result.complete && result.runs.length).toBe(30)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("reports an incomplete history when the page cap is reached", async () => {
    const load = pagedLoader(hourly(1, 200, 1))
    const result = await loadPeriodRuns(load, PERIOD.startsAt, 3)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.complete).toBe(false)
    expect(result.runs).toHaveLength(72)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it("returns a failed page as is", async () => {
    const failure = {
      ok: false as const,
      code: "unavailable" as const,
      status: 503 as const,
      message: "We couldn't load preparation runs.",
    }
    const load = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        items: hourly(35, 58, -1),
        nextCursor: "24",
      })
      .mockResolvedValueOnce(failure)
    expect(await loadPeriodRuns(load, PERIOD.startsAt)).toEqual(failure)
  })
})

describe("buildPreparation with more than 24 runs this month", () => {
  const now = new Date(at(58))
  const runs = hourly(1, 58, 1)
  const rows = [
    row(BELL, { lastPreparation: { at: at(58), status: "succeeded" } }),
    row(HORSE, {
      participation: {
        staff: 4,
        targetsSet: 2,
        targetsNeedingSetup: 0,
        staffWithoutTarget: 2,
        complete: 0,
        acceptedPhotos: 0,
      },
      lastPreparation: { at: at(58), status: "succeeded" },
    }),
  ]

  it("credits the run that prepared the venue, not the oldest visible run", () => {
    const model = buildPreparation(rows, runs, PERIOD, now, { status: STATUS })
    const bell = model.venues.find((v) => v.venue.id === BELL.id)!
    expect(bell.state).toBe("prepared")
    expect(bell.preparedBy?.run.finishedAt).toBe(at(1))
    expect(bell.preparedAt).toBe(at(1))
    expect(model.recent.map((e) => e.run.finishedAt)).toEqual([at(1)])
    expect(model.recent[0]?.prepared.map((v) => v.name)).toEqual(["The Bell"])
    expect(model.noSuccessThisMonth).toBe(false)
    expect(model.lastRunAt).toBe(at(58))
    expect(model.entries).toHaveLength(58)
  })

  it("keeps each venue's state from the overview", () => {
    const model = buildPreparation(rows, runs, PERIOD, now, { status: STATUS })
    expect(model.unprepared.map((v) => v.venue.name)).toEqual([
      "The White Horse",
    ])
    expect(model.unfinished).toEqual([])
  })

  it("falls back to the overview when the history is cut short", () => {
    // Only the newest page: the run that copied targets isn't in it.
    const model = buildPreparation(rows, runs.slice(0, 24), PERIOD, now, {
      status: STATUS,
      complete: false,
    })
    const bell = model.venues.find((v) => v.venue.id === BELL.id)!
    expect(bell.state).toBe("prepared")
    expect(bell.preparedAt).toBeNull()
    expect(model.noSuccessThisMonth).toBe(false)
    expect(model.lastRunAt).toBe(at(58))
  })

  it("knows the month succeeded from the overview alone", () => {
    const model = buildPreparation(rows, [], PERIOD, now, { status: STATUS })
    expect(model.noSuccessThisMonth).toBe(false)
    expect(model.lastRunAt).toBe(at(58))
  })

  it("reports no success only when nothing succeeded this month", () => {
    const failedRows = rows.map((r) => ({
      ...r,
      lastPreparation: { at: at(58), status: "failed" as const },
    }))
    const failures = hourly(1, 58, -1).map((r) => ({
      ...r,
      status: "failed" as const,
      errorCode: "40001",
    }))
    const model = buildPreparation(failedRows, failures, PERIOD, now, {
      status: {
        ...STATUS,
        lastStatus: "failed",
        lastSuccessAt: null,
        lastFailureAt: at(58),
        lastErrorCode: "40001",
      },
    })
    expect(model.noSuccessThisMonth).toBe(true)
    expect(model.unfinished).toHaveLength(2)
  })

  it("ignores another month's status", () => {
    const model = buildPreparation(rows, [], PERIOD, now, {
      status: {
        ...STATUS,
        period: { ...PERIOD, key: "2026-10" },
        lastRunAt: at(-5),
      },
    })
    expect(model.lastRunAt).toBe(at(58))
  })

  it("finds a venue's failure from the overview's recent failures", () => {
    const failedRows = [
      row(BELL, { lastPreparation: { at: at(57), status: "failed" } }),
    ]
    const failure = run(57, {
      id: "failed-run",
      status: "failed",
      errorCode: "40001",
    })
    const model = buildPreparation(failedRows, runs.slice(0, 1), PERIOD, now, {
      status: STATUS,
      recentFailures: [
        failure,
        run(-3, { id: "october", period: "2026-10", status: "failed" }),
      ],
    })
    const bell = model.unfinished[0]!
    expect(failuresFor(model, bell)?.run.id).toBe("failed-run")
    expect(model.entries.map((e) => e.run.id)).not.toContain("october")
  })
})

describe("failureCode", () => {
  it("names a target conflict with the deck's code", () => {
    for (const code of ["23505", "40001", "40P01", "55P03"])
      expect(failureCode(code)).toBe("PREP_TARGET_CONFLICT")
  })

  it("keeps any other SQLSTATE", () => {
    expect(failureCode("P0001")).toBe("P0001")
  })
})

describe("late in the month", () => {
  // 29 Nov 10:00: 682 hourly runs this month; only the first copied targets.
  const nowHour = 28 * 24 + 10
  const now = new Date(at(nowHour))
  const runs = hourly(1, nowHour, 1)
  const rows = [
    row(BELL, { lastPreparation: { at: at(nowHour), status: "succeeded" } }),
  ]

  it("reads runs back to Recent runs' window, not the start of the month", () => {
    expect(runsSince(PERIOD, now)).toBe(at(nowHour - 7 * 24))
    expect(runsSince(PERIOD, new Date(at(58)))).toBe(PERIOD.startsAt)
  })

  it("pages about a week of runs", async () => {
    const load = pagedLoader(runs)
    const result = await loadPeriodRuns(load, runsSince(PERIOD, now))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.complete).toBe(true)
    expect(result.runs).toHaveLength(7 * 24 + 1)
    expect(load).toHaveBeenCalledTimes(8)
  })

  async function lateModel(monthRuns: PreparationRunView[], venueRows = rows) {
    const since = runsSince(PERIOD, now)
    const result = await loadPeriodRuns(pagedLoader(monthRuns), since)
    if (!result.ok) throw new Error("load failed")
    return buildPreparation(venueRows, result.runs, PERIOD, now, {
      status: { ...STATUS, lastRunAt: at(nowHour), lastSuccessAt: at(nowHour) },
      complete: result.complete && since === PERIOD.startsAt,
    })
  }

  it("shows Prepared with no time when the preparing run is older", async () => {
    const model = await lateModel(runs)
    const bell = model.venues[0]!
    expect(bell.state).toBe("prepared")
    expect(bell.preparedBy).toBeNull()
    expect(bell.preparedAt).toBeNull()
    expect(PREPARATION_COPY.prepared(bell.preparedAt)).toBe("Prepared")
    expect(model.recent).toEqual([])
    expect(model.noSuccessThisMonth).toBe(false)
    expect(model.lastRunAt).toBe(at(nowHour))
  })

  it("doesn't credit an all-venues top-up to every venue", async () => {
    // 26 Nov 14:00: an all-venues run adds one new starter's placeholder.
    const topUpHour = 25 * 24 + 14
    const withTopUp = runs.map((r) =>
      r.finishedAt === at(topUpHour)
        ? run(topUpHour, { placeholdersCreated: 1, alreadyPresent: 11 })
        : r
    )
    const model = await lateModel(withTopUp, [
      ...rows,
      row(HORSE, {
        lastPreparation: { at: at(nowHour), status: "succeeded" },
      }),
    ])
    expect(model.venues).toHaveLength(2)
    for (const venue of model.venues) {
      expect(venue.state).toBe("prepared")
      expect(venue.preparedBy).toBeNull()
      expect(PREPARATION_COPY.prepared(venue.preparedAt)).toBe("Prepared")
    }
    const topUp = model.recent.find((e) => e.run.finishedAt === at(topUpHour))
    expect(topUp?.prepared).toEqual([])
    expect(
      PREPARATION_COPY.runCounts(
        topUp!.run.targetsCopied,
        topUp!.run.placeholdersCreated,
        topUp!.run.candidatesAdded
      )
    ).toBe("1 needs setup")
  })

  it("keeps the time of a run scoped to the venue", async () => {
    const scopedHour = nowHour - 30
    const withScoped = runs.map((r) =>
      r.finishedAt === at(scopedHour)
        ? run(scopedHour, {
            venueId: BELL.id,
            trigger: "manual",
            targetsCopied: 2,
            alreadyPresent: 10,
          })
        : r
    )
    const model = await lateModel(withScoped)
    const bell = model.venues[0]!
    expect(bell.preparedAt).toBe(at(scopedHour))
    expect(model.recent.map((e) => e.run.finishedAt)).toEqual([at(scopedHour)])
    expect(model.recent[0]?.prepared.map((v) => v.name)).toEqual(["The Bell"])
  })
})
