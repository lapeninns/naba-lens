import { formatTime } from "@/components/nabalens/format"
import type {
  CoverageResult,
  CoverageVenue,
  GroupOverviewRow,
  Page,
  PeriodView,
  PreparationRunView,
  PreparationStatusView,
} from "@/lib/server/coverage/types"

export type PreparationEntry = {
  run: PreparationRunView
  /** Venues this run prepared (each venue is credited to one run at most). */
  prepared: CoverageVenue[]
}

export type VenuePreparation = {
  venue: CoverageVenue
  state: "prepared" | "not_prepared" | "didnt_finish"
  /** The entry that prepared the venue, from the same list as Recent runs. */
  preparedBy: PreparationEntry | null
  /** `preparedBy`'s time, else the venue's latest run when history ran out. */
  preparedAt: string | null
  staff: number
  withTarget: number
  staffWithoutTarget: number
  needSetup: number
}

export type PreparationModel = {
  /** One entry per run this month, newest first: the single source for both tables. */
  entries: PreparationEntry[]
  venues: VenuePreparation[]
  /** Entries in the last seven days that prepared a venue or failed. */
  recent: PreparationEntry[]
  recentSince: string
  unprepared: VenuePreparation[]
  unfinished: VenuePreparation[]
  /** No succeeded run has finished since the month started. */
  noSuccessThisMonth: boolean
  lastRunAt: string | null
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * A week of hourly runs is 168 rows, 7 pages of 24; the cap leaves room for
 * manual runs while bounding a page render.
 */
export const RUN_PAGE_LIMIT = 10

/**
 * How far back the page reads runs: Recent runs' window, the last seven days
 * of the period. Venue state and the month's success come from the overview,
 * so older runs only matter for a venue's "Prepared" time.
 */
export function runsSince(period: PeriodView, now: Date): string {
  return new Date(
    Math.max(new Date(period.startsAt).getTime(), now.getTime() - WEEK_MS)
  ).toISOString()
}

export type PeriodRuns = {
  /** Every run that finished since `since`, newest first. */
  runs: PreparationRunView[]
  /** The first page as served, for the full paged history. */
  firstPage: Page<PreparationRunView>
  /** False when the page cap stopped paging before `since`. */
  complete: boolean
}

/**
 * Pages the newest-first run list until it passes `since`, so hourly runs
 * can't push the runs Recent runs needs off a single page.
 */
export async function loadPeriodRuns(
  load: (
    cursor: string | null
  ) => Promise<CoverageResult<Page<PreparationRunView>>>,
  since: string,
  maxPages = RUN_PAGE_LIMIT
): Promise<CoverageResult<PeriodRuns>> {
  const start = new Date(since).getTime()
  const runs: PreparationRunView[] = []
  let firstPage: Page<PreparationRunView> = { items: [], nextCursor: null }
  let cursor: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const result = await load(cursor)
    if (!result.ok) return result
    if (page === 0)
      firstPage = { items: result.items, nextCursor: result.nextCursor }
    for (const run of result.items) {
      if (new Date(run.finishedAt).getTime() < start)
        return { ok: true, runs, firstPage, complete: true }
      runs.push(run)
    }
    if (!result.nextCursor) return { ok: true, runs, firstPage, complete: true }
    cursor = result.nextCursor
  }
  return { ok: true, runs, firstPage, complete: false }
}

const did = (run: PreparationRunView) =>
  run.targetsCopied + run.placeholdersCreated + run.candidatesAdded > 0

const covers = (run: PreparationRunView, venueId: string) =>
  run.venueId === null || run.venueId === venueId

/**
 * Builds the venue table and Recent runs from one list of this month's runs,
 * so a venue's "Prepared" time is always a run Recent runs shows. Runs record
 * counts, not venues: a venue is credited to the earliest run covering it
 * that changed something, else the earliest covering success.
 *
 * Each venue's state comes from the overview's `lastPreparation`, and the
 * month's success and last run also read the overview's status, so they hold
 * even when the run history is incomplete.
 */
export function buildPreparation(
  rows: GroupOverviewRow[],
  runs: PreparationRunView[],
  period: PeriodView,
  now: Date,
  overview: {
    status?: PreparationStatusView | null
    recentFailures?: PreparationRunView[]
    /** False when `runs` may not reach back to the start of the period. */
    complete?: boolean
  } = {}
): PreparationModel {
  const byId = new Map<string, PreparationRunView>()
  for (const run of [...runs, ...(overview.recentFailures ?? [])])
    if (run.period === period.key) byId.set(run.id, run)
  const oldestFirst = [...byId.values()].sort(
    (a, b) =>
      a.finishedAt.localeCompare(b.finishedAt) || a.id.localeCompare(b.id)
  )
  const entries: PreparationEntry[] = oldestFirst.map((run) => ({
    run,
    prepared: [],
  }))

  const venues = rows.map((row): VenuePreparation => {
    const { staff, staffWithoutTarget, targetsNeedingSetup } = row.participation
    const state: VenuePreparation["state"] =
      row.lastPreparation?.status === "failed"
        ? "didnt_finish"
        : staffWithoutTarget > 0 || !row.lastPreparation
          ? "not_prepared"
          : "prepared"
    const covering = entries.filter(
      (e) => e.run.status === "succeeded" && covers(e.run, row.venue.id)
    )
    // The earliest visible success is only the first of the month when the
    // history is complete; otherwise the venue's latest run is the honest time.
    const preparedBy =
      state === "prepared"
        ? (covering.find((e) => did(e.run)) ??
          (overview.complete === false ? null : covering[0]) ??
          null)
        : null
    preparedBy?.prepared.push(row.venue)
    return {
      venue: row.venue,
      state,
      preparedBy,
      preparedAt:
        state === "prepared"
          ? (preparedBy?.run.finishedAt ?? row.lastPreparation?.at ?? null)
          : null,
      staff,
      withTarget: staff - staffWithoutTarget,
      staffWithoutTarget,
      needSetup: staffWithoutTarget + targetsNeedingSetup,
    }
  })

  const since = new Date(runsSince(period, now)).getTime()
  const newestFirst = [...entries].reverse()
  const recent = newestFirst.filter(
    (e) =>
      new Date(e.run.finishedAt).getTime() >= since &&
      (e.run.status === "failed" || e.prepared.length > 0)
  )
  const status =
    overview.status?.period.key === period.key ? overview.status : null
  const succeeded =
    !!status?.lastSuccessAt ||
    rows.some((row) => row.lastPreparation?.status === "succeeded") ||
    newestFirst.some((e) => e.run.status === "succeeded")
  const lastRunAt = latest([
    status?.lastRunAt,
    newestFirst[0]?.run.finishedAt,
    ...rows.map((row) => row.lastPreparation?.at),
  ])

  return {
    entries: newestFirst,
    venues,
    recent,
    recentSince: new Date(since).toISOString(),
    unprepared: venues.filter((v) => v.state === "not_prepared"),
    unfinished: venues.filter((v) => v.state === "didnt_finish"),
    noSuccessThisMonth: !succeeded,
    lastRunAt,
  }
}

function latest(times: (string | null | undefined)[]): string | null {
  let best: string | null = null
  let bestMs = -Infinity
  for (const time of times) {
    if (!time) continue
    const ms = new Date(time).getTime()
    if (ms > bestMs) {
      best = time
      bestMs = ms
    }
  }
  return best
}

/** Failed runs that touched a venue that didn't finish, newest first. */
export function failuresFor(
  model: PreparationModel,
  venue: VenuePreparation
): PreparationEntry | undefined {
  return model.entries.find(
    (e) => e.run.status === "failed" && covers(e.run, venue.venue.id)
  )
}

/** The next top of the hour, London time, as "15:00". */
export function nextHourlyRun(now: Date): string {
  const next = new Date(now)
  next.setUTCMinutes(0, 0, 0)
  next.setUTCHours(next.getUTCHours() + 1)
  return formatTime(next)
}
