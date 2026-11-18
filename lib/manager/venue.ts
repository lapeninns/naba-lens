/**
 * S2-MGR (Full App v1): the manager's venue model, shared by Overview and the
 * Venue hub (spec §7 M1, M5, §9.3). Pure types, parsers and words; the reads
 * and commands are in lib/server/manager/venue.ts.
 */

export type ReviewerRole = "main" | "backup"
export const REVIEWER_ROLES: ReadonlyArray<ReviewerRole> = ["main", "backup"]

export const REVIEWER_ROLE_LABEL: Record<ReviewerRole, string> = {
  main: "Main reviewer",
  backup: "Backup reviewer",
}

export type ReviewerPerson = {
  profileId: string
  name: string
  /** ISO instant the role was given; absent on a candidate. */
  since: string | null
}

export type VenueReviewers = {
  venueId: string
  main: ReviewerPerson | null
  backup: ReviewerPerson | null
  /** People who hold manager permission at the venue now. */
  candidates: { profileId: string; name: string }[]
}

/** The month's "menu still right" check (spec §9.3); null without a menu. */
export type MenuMonthCheck = {
  /** YYYY-MM-DD, the first day of the month in the venue's timezone. */
  month: string
  menuVersionId: string
  menuTitle: string
  due: boolean
  confirmedAt: string | null
  confirmedBy: string | null
}

export type ManagerVenueSummary = {
  venueId: string
  menuCheck: MenuMonthCheck | null
  /** Food and drink photos at the venue with no dish label (Review's filter). */
  unlabelledPhotos: number
  reviewers: { main: ReviewerPerson | null; backup: ReviewerPerson | null }
}

export type VenueHistoryItem = {
  source: string
  id: string
  at: string
  actorName: string | null
  actorRole: string
  action: string
  objectType: string
  objectId: string | null
  reason: string | null
}

export type HistoryCursor = { at: string; source: string; id: string }

export type VenueHistoryPage = {
  venueId: string
  items: VenueHistoryItem[]
  nextCursor: HistoryCursor | null
}

// ---------------------------------------------------------------------------
// Parsers (database JSON is untrusted in shape)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null

function parsePerson(v: unknown): ReviewerPerson | null {
  const o = obj(v)
  const profileId = str(o?.profileId)
  if (!o || !profileId) return null
  return {
    profileId,
    name: str(o.name) ?? "Unnamed",
    since: str(o.since),
  }
}

export function parseReviewers(data: unknown): VenueReviewers | null {
  const o = obj(data)
  const venueId = str(o?.venueId)
  if (!o || !venueId || !Array.isArray(o.candidates)) return null
  return {
    venueId,
    main: parsePerson(o.main),
    backup: parsePerson(o.backup),
    candidates: o.candidates.flatMap((c) => {
      const p = parsePerson(c)
      return p ? [{ profileId: p.profileId, name: p.name }] : []
    }),
  }
}

export function parseMenuCheck(data: unknown): MenuMonthCheck | null {
  const o = obj(data)
  const month = str(o?.month)
  const menuVersionId = str(o?.menuVersionId)
  if (!o || !month || !menuVersionId || typeof o.due !== "boolean") return null
  return {
    month,
    menuVersionId,
    menuTitle: str(o.menuTitle) ?? "Menu",
    due: o.due,
    confirmedAt: str(o.confirmedAt),
    confirmedBy: str(o.confirmedBy),
  }
}

export function parseVenueSummary(data: unknown): ManagerVenueSummary | null {
  const o = obj(data)
  const venueId = str(o?.venueId)
  const unlabelled = int(o?.unlabelledPhotos)
  const reviewers = obj(o?.reviewers)
  if (!o || !venueId || unlabelled === null || !reviewers) return null
  return {
    venueId,
    menuCheck: parseMenuCheck(o.menuCheck),
    unlabelledPhotos: unlabelled,
    reviewers: {
      main: parsePerson(reviewers.main),
      backup: parsePerson(reviewers.backup),
    },
  }
}

export function parseCursor(v: unknown): HistoryCursor | null {
  const o = obj(v)
  const at = str(o?.at)
  const source = str(o?.source)
  const id = typeof o?.id === "number" ? String(o.id) : str(o?.id)
  return at && source && id ? { at, source, id } : null
}

export function parseVenueHistory(data: unknown): VenueHistoryPage | null {
  const o = obj(data)
  const venueId = str(o?.venueId)
  if (!o || !venueId || !Array.isArray(o.items)) return null
  const items = o.items.flatMap((raw): VenueHistoryItem[] => {
    const i = obj(raw)
    const source = str(i?.source)
    const id = typeof i?.id === "number" ? String(i.id) : str(i?.id)
    const at = str(i?.at)
    const action = str(i?.action)
    if (!i || !source || !id || !at || !action) return []
    return [
      {
        source,
        id,
        at,
        actorName: str(i.actorName),
        actorRole: str(i.actorRole) ?? "system",
        action,
        objectType: str(i.objectType) ?? "",
        objectId: str(i.objectId),
        reason: str(i.reason),
      },
    ]
  })
  return { venueId, items, nextCursor: parseCursor(o.nextCursor) }
}

// ---------------------------------------------------------------------------
// Words (DESIGN.md §7: plain, British, sentence case)
// ---------------------------------------------------------------------------

/** What a history row says happened. Unknown actions fall back to the code's words. */
const ACTION_WORDS: Record<string, string> = {
  reviewer_assigned: "Reviewer nominated",
  reviewer_ended: "Reviewer role ended",
  menu_month_confirmed: "Menu confirmed as still right",
  applicability_removed: "Marked not here",
  applicability_restored: "Marked as here again",
  scope_applies: "Now applies at this venue",
  scope_not_applicable: "No longer applies at this venue",
  fact_reconfirmed: "Fact confirmed as still right",
  fact_next_check_set: "Next check date set",
  special_suggested: "Special suggested",
  special_running: "Special started",
  special_declined: "Special declined",
  special_ended: "Special ended",
  change_request_open: "Menu change requested",
  change_request_accepted: "Menu change accepted",
  change_request_declined: "Menu change declined",
  change_request_clarification_requested: "Menu change needs more detail",
  change_request_withdrawn: "Menu change withdrawn",
  account_deactivated: "Account deactivated",
  account_reactivated: "Account reactivated",
  account_role_changed: "Role changed",
  account_venue_changed: "Venue changed",
  media_removed: "Photo removed",
  place_set: "Album place set",
  place_cleared: "Album place cleared",
  brief_set: "Brief written",
  brief_cleared: "Brief cleared",
}

export function historyActionWords(action: string): string {
  const known = ACTION_WORDS[action]
  if (known) return known
  const words = action.replace(/_/g, " ").trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Change"
}

/** History filters shown on the History page: label and the source it reads. */
export const HISTORY_SOURCES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "activity", label: "Team and settings" },
  { key: "menu", label: "Menus" },
  { key: "menu_photo", label: "Dish photos" },
  { key: "special", label: "Specials" },
  { key: "change_request", label: "Menu changes" },
  { key: "amenity", label: "Facilities" },
  { key: "amenity_scope", label: "Not here" },
  { key: "fact_check", label: "Facts" },
  { key: "area_photo", label: "Space photos" },
]

export function isHistorySource(v: unknown): v is string {
  return typeof v === "string" && HISTORY_SOURCES.some((s) => s.key === v)
}
