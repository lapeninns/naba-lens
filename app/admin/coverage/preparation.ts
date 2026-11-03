import { formatTime } from "@/components/nabalens/format"
import type {
  CoverageVenue,
  GroupOverviewRow,
  PeriodView,
  PreparationRunView,
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

const did = (run: PreparationRunView) =>
  run.targetsCopied + run.placeholdersCreated + run.candidatesAdded > 0

const covers = (run: PreparationRunView, venueId: string) =>
  run.venueId === null || run.venueId === venueId

/**
 * Builds the venue table and Recent runs from one list of this month's runs,
 * so a venue's "Prepared" time is always a run Recent runs shows. Runs record
 * counts, not venues: a venue is credited to the earliest run covering it
 * that changed something, else the earliest covering success.
 */
export function buildPreparation(
  rows: GroupOverviewRow[],
  runs: PreparationRunView[],
  period: PeriodView,
  now: Date
): PreparationModel {
  const oldestFirst = runs
    .filter((run) => run.period === period.key)
    .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
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
    const preparedBy =
      state === "prepared"
        ? (covering.find((e) => did(e.run)) ?? covering[0] ?? null)
        : null
    preparedBy?.prepared.push(row.venue)
    return {
      venue: row.venue,
      state,
      preparedBy,
      staff,
      withTarget: staff - staffWithoutTarget,
      staffWithoutTarget,
      needSetup: staffWithoutTarget + targetsNeedingSetup,
    }
  })

  const since = Math.max(
    new Date(period.startsAt).getTime(),
    now.getTime() - WEEK_MS
  )
  const newestFirst = [...entries].reverse()
  const recent = newestFirst.filter(
    (e) =>
      new Date(e.run.finishedAt).getTime() >= since &&
      (e.run.status === "failed" || e.prepared.length > 0)
  )
  const lastSuccess = newestFirst.find((e) => e.run.status === "succeeded")

  return {
    entries: newestFirst,
    venues,
    recent,
    recentSince: new Date(since).toISOString(),
    unprepared: venues.filter((v) => v.state === "not_prepared"),
    unfinished: venues.filter((v) => v.state === "didnt_finish"),
    noSuccessThisMonth: !lastSuccess,
    lastRunAt: newestFirst[0]?.run.finishedAt ?? null,
  }
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
