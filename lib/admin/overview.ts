// Admin group overview (Full App v1, S2-ADMIN; spec §8 A1; AC39). Pure and
// client-safe: the shape public.admin_group_overview returns
// (20261118115100_admin_group_overview.sql), the URL filters, where each
// number links, and which venues need attention first.

import { COVERAGE_CATEGORIES } from "@/lib/album/model"
import { coverageWords } from "@/lib/knowledge/facts"

import {
  effectiveOperatingStatus,
  parseSetup,
  type SetupChecklist,
} from "./venues"

export type OverviewCategory =
  "food" | "drinks" | "spaces" | "facilities" | "other"

/** The album's categories and their words (one source: lib/album/model). */
export const OVERVIEW_CATEGORIES: ReadonlyArray<{
  key: OverviewCategory
  label: string
}> = COVERAGE_CATEGORIES

/** Spec §8 A1 names four; Other is a filter choice (FA-6). */
export const DEFAULT_CATEGORIES: ReadonlyArray<OverviewCategory> = [
  "food",
  "drinks",
  "spaces",
  "facilities",
]

export type CategoryCounts = {
  category: OverviewCategory
  /** Every slot except Not here and inactive (the denominator). */
  total: number
  /** Covered: the numerator (§18.1). */
  covered: number
  pending: number
  checkDue: number
  missing: number
  replacementNeeded: number
}

export type OverviewRow = {
  venueId: string
  name: string
  timezone: string
  operatingStatus: string
  active: boolean
  categories: CategoryCounts[]
  nextMenu: { versionId: string; title: string; scheduledFor: string } | null
  facts: {
    confirmed: number
    total: number
    checkDue: number
    unconfirmed: number
  }
  unlabelled: number
  review: { waiting: number; oldestAt: string | null }
  /**
   * Checks due, each subject once (S3-R6, V20): dish rechecks, place photos
   * past their check date, facility photos asked to be checked again whose
   * fact is not itself due, and facts due. `slots` is the three photo parts.
   */
  checksDue: {
    dishes: number
    places: number
    facilities: number
    slots: number
    facts: number
    total: number
  }
  publication: { failed: number; withdrawalPending: number; total: number }
  /** Photos added in the reporting period; null without one. */
  added: number | null
  setup: SetupChecklist
}

export type MenuFilter = "current" | "next"

export type OverviewFilters = {
  /** null: every venue. */
  venueId: string | null
  categories: OverviewCategory[]
  menu: MenuFilter
  /** "YYYY-MM" (Europe/London month). */
  period: string
}

// ---- parsing -----------------------------------------------------------------

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0
const CATEGORY_KEYS = new Set<string>(OVERVIEW_CATEGORIES.map((c) => c.key))

function parseCategory(v: unknown): CategoryCounts | null {
  if (!isObj(v) || typeof v.category !== "string") return null
  if (!CATEGORY_KEYS.has(v.category)) return null
  return {
    category: v.category as OverviewCategory,
    total: num(v.total),
    covered: num(v.covered),
    pending: num(v.pending),
    checkDue: num(v.checkDue),
    missing: num(v.missing),
    replacementNeeded: num(v.replacementNeeded),
  }
}

export function parseOverviewRow(v: unknown): OverviewRow | null {
  if (!isObj(v)) return null
  const venueId = str(v.venueId)
  const name = str(v.name)
  if (!venueId || !name) return null
  const facts = isObj(v.facts) ? v.facts : {}
  const review = isObj(v.review) ? v.review : {}
  const checks = isObj(v.checksDue) ? v.checksDue : {}
  const publication = isObj(v.publication) ? v.publication : {}
  const next = isObj(v.nextMenu) ? v.nextMenu : null
  return {
    venueId,
    name,
    timezone: str(v.timezone) ?? "Europe/London",
    // A venue switched off is archived whatever its stored trading state
    // (S3-R6, V22).
    operatingStatus: effectiveOperatingStatus(
      str(v.operatingStatus) ?? "open",
      v.active === true
    ),
    active: v.active === true,
    categories: (Array.isArray(v.categories) ? v.categories : [])
      .map(parseCategory)
      .filter((c): c is CategoryCounts => c !== null),
    nextMenu:
      next && str(next.versionId)
        ? {
            versionId: next.versionId as string,
            title: str(next.title) ?? "",
            scheduledFor: str(next.scheduledFor) ?? "",
          }
        : null,
    facts: {
      confirmed: num(facts.confirmed),
      total: num(facts.total),
      checkDue: num(facts.checkDue),
      unconfirmed: num(facts.unconfirmed),
    },
    unlabelled: num(v.unlabelled),
    review: { waiting: num(review.waiting), oldestAt: str(review.oldestAt) },
    checksDue: {
      dishes: num(checks.dishes),
      places: num(checks.places),
      facilities: num(checks.facilities),
      slots: num(checks.slots),
      facts: num(checks.facts),
      total: num(checks.total),
    },
    publication: {
      failed: num(publication.failed),
      withdrawalPending: num(publication.withdrawalPending),
      total: num(publication.total),
    },
    added: typeof v.added === "number" ? v.added : null,
    setup: parseSetup(v.setup),
  }
}

export function parseOverview(data: unknown): OverviewRow[] | null {
  if (!isObj(data) || !Array.isArray(data.rows)) return null
  return data.rows
    .map(parseOverviewRow)
    .filter((r): r is OverviewRow => r !== null)
}

// ---- filters -----------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/

type Search = Record<string, string | string[] | undefined>
const all = (v: string | string[] | undefined) =>
  v === undefined ? [] : Array.isArray(v) ? v : [v]
const first = (v: string | string[] | undefined) => all(v)[0]

/**
 * URL search params onto filters. Never throws: an unknown value means that
 * filter is off. `currentPeriod` is today's London month; a later month is
 * not a reporting period yet.
 */
export function parseOverviewFilters(
  search: Search,
  currentPeriod: string
): OverviewFilters {
  const venue = first(search.venue)
  const menu = first(search.menu)
  const period = first(search.period)
  const categories = all(search.category).filter((c): c is OverviewCategory =>
    CATEGORY_KEYS.has(c)
  )
  return {
    venueId: venue && UUID.test(venue) ? venue.toLowerCase() : null,
    categories: categories.length
      ? OVERVIEW_CATEGORIES.map((c) => c.key).filter((k) =>
          categories.includes(k)
        )
      : [...DEFAULT_CATEGORIES],
    menu: menu === "next" ? "next" : "current",
    period:
      period && PERIOD.test(period) && period <= currentPeriod
        ? period
        : currentPeriod,
  }
}

/** First and last day of a "YYYY-MM" month. */
export function periodRange(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return {
    from: `${period}-01`,
    to: `${period}-${String(last).padStart(2, "0")}`,
  }
}

/** The last `count` months ending at `current`, newest first. */
export function recentPeriods(current: string, count = 12): string[] {
  const [y, m] = current.split("-").map(Number)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
  })
}

const MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
})

export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number)
  return MONTH.format(new Date(Date.UTC(y, m - 1, 1)))
}

// ---- where each number links (A1-numbers-link) --------------------------------

export function categoryHref(
  venueId: string,
  category: OverviewCategory,
  menu: MenuFilter,
  nextMenuId: string | null
): string {
  const base = `/admin/coverage/${venueId}`
  switch (category) {
    case "food":
    case "drinks":
    case "other":
      return menu === "next" && nextMenuId
        ? `/admin/menus/versions/${nextMenuId}`
        : `${base}/menu-photos`
    case "spaces":
      return `${base}/amenities/places`
    case "facilities":
      return `${base}/amenities`
  }
}

export type CheckPart = "dishes" | "places" | "facilities" | "facts"

/** The parts of Checks due in display order, with the words for each. */
export const CHECK_PARTS: ReadonlyArray<{
  key: CheckPart
  words: (n: number) => string
}> = [
  { key: "dishes", words: (n) => (n === 1 ? "1 dish" : `${n} dishes`) },
  { key: "places", words: (n) => (n === 1 ? "1 place" : `${n} places`) },
  {
    key: "facilities",
    words: (n) => (n === 1 ? "1 facility" : `${n} facilities`),
  },
  { key: "facts", words: (n) => (n === 1 ? "1 fact" : `${n} facts`) },
]

/** Where each part of Checks due is listed (S3-R6, V20). */
export function checkPartHrefs(venueId: string): Record<CheckPart, string> {
  const base = `/admin/coverage/${venueId}`
  return {
    dishes: `${base}/menu-photos?status=recheck`,
    places: `${base}/amenities/places`,
    facilities: `${base}/amenities`,
    facts: `${base}/amenities`,
  }
}

export function rowHrefs(row: OverviewRow, filters: OverviewFilters) {
  const base = `/admin/coverage/${row.venueId}`
  const { from, to } = periodRange(filters.period)
  const library = (extra: string) => `/admin?venue=${row.venueId}${extra}`
  const parts = checkPartHrefs(row.venueId)
  // The total opens the part that holds the most checks (the first on a tie).
  const biggest = CHECK_PARTS.reduce<CheckPart>(
    (best, p) => (row.checksDue[p.key] > row.checksDue[best] ? p.key : best),
    "dishes"
  )
  return {
    venue: `/admin/venues/${row.venueId}`,
    facts: `${base}/amenities`,
    unlabelled: library("&labels=unlabelled"),
    // The dish and place queues the waiting count reads (S3-R6, V18), not the
    // legacy checklist queue.
    review: `${base}/menu-photos`,
    checksDue: parts[biggest],
    checkParts: parts,
    publication: "/admin/publishing",
    added: library(`&from=${from}&to=${to}`),
    setup: `/admin/venues/${row.venueId}#setup`,
  }
}

// ---- reading the numbers -----------------------------------------------------

/**
 * "n of N" with the percentage as secondary text (FA-8). The percentage is
 * the same rule as Metrics and the manager Overview (`coverageWords`, one
 * decimal; S3-R6, F5).
 */
export function ofWords(n: number, d: number): { main: string; pct: string } {
  const words = coverageWords(n, d)
  return { main: words.text, pct: words.percent ?? "" }
}

/** How long the oldest photo has waited: "Under a day", "3 days". */
export function ageWords(oldestAt: string | null, now: Date): string | null {
  if (!oldestAt) return null
  const ms = now.getTime() - new Date(oldestAt).getTime()
  if (!Number.isFinite(ms)) return null
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) return "Under a day"
  return days === 1 ? "1 day" : `${days} days`
}

export type Attention =
  | { kind: "setup"; missing: number }
  | { kind: "publication"; count: number }
  | { kind: "checks"; count: number }
  | { kind: "review"; days: number }

/** ops_settings.backlog_alert_days when it can't be read (its default). */
export const DEFAULT_BACKLOG_ALERT_DAYS = 7

/**
 * Spec §8 A1: blocked setup and operational exceptions come first. A long
 * wait uses the admin's backlog alert setting and the monitoring rule: the
 * oldest photo has waited more than that many days (S3-R6, V21).
 */
export function rowAttention(
  row: OverviewRow,
  now: Date,
  reviewAlertDays = DEFAULT_BACKLOG_ALERT_DAYS
): Attention[] {
  const out: Attention[] = []
  if (row.active && row.setup.done < row.setup.total)
    out.push({ kind: "setup", missing: row.setup.total - row.setup.done })
  if (row.publication.total > 0)
    out.push({ kind: "publication", count: row.publication.total })
  if (row.checksDue.total > 0)
    out.push({ kind: "checks", count: row.checksDue.total })
  if (row.review.oldestAt) {
    const ms = now.getTime() - new Date(row.review.oldestAt).getTime()
    if (ms > reviewAlertDays * 86_400_000)
      out.push({ kind: "review", days: Math.floor(ms / 86_400_000) })
  }
  return out
}

export function attentionWords(a: Attention): string {
  switch (a.kind) {
    case "setup":
      return a.missing === 1
        ? "1 setup step missing"
        : `${a.missing} setup steps missing`
    case "publication":
      return a.count === 1
        ? "1 publication error"
        : `${a.count} publication errors`
    case "checks":
      return a.count === 1 ? "1 check due" : `${a.count} checks due`
    case "review":
      return `Oldest photo waiting ${a.days} days`
  }
}

/**
 * Venues needing attention first, then the rest, each group in name order.
 * Nothing is ranked by performance (spec §8 A1, §18).
 */
export function attentionFirst(
  rows: OverviewRow[],
  now: Date,
  reviewAlertDays = DEFAULT_BACKLOG_ALERT_DAYS
): { attention: OverviewRow[]; rest: OverviewRow[] } {
  const attention: OverviewRow[] = []
  const rest: OverviewRow[] = []
  for (const row of rows)
    (rowAttention(row, now, reviewAlertDays).length ? attention : rest).push(
      row
    )
  return { attention, rest }
}

/** Column totals across rows, for the table's last line. */
export function categoryTotals(
  rows: OverviewRow[],
  category: OverviewCategory
): { covered: number; total: number } {
  return rows.reduce(
    (sum, row) => {
      const c = row.categories.find((x) => x.category === category)
      return c
        ? { covered: sum.covered + c.covered, total: sum.total + c.total }
        : sum
    },
    { covered: 0, total: 0 }
  )
}
