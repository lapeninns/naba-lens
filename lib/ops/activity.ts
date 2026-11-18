// The admin Activity log (spec §8 A7; 20261118106000_ops_activity.sql). Pure
// and client-safe: parsing the read, the cursor in the URL, and the words for
// actions and sources.

export type ActivityItem = {
  source: string
  id: number
  at: string
  actorId: string | null
  actorName: string | null
  actorRole: string
  venueId: string | null
  venueName: string | null
  action: string
  objectType: string
  objectId: string | null
  oldRevision: number | null
  newRevision: number | null
  reason: string | null
}

export type ActivityCursor = { at: string; source: string; id: number }

export type ActivityPage = {
  items: ActivityItem[]
  nextCursor: ActivityCursor | null
}

/** History sources, as the database names them, with their words. */
export const ACTIVITY_SOURCES = [
  { id: "activity", label: "Accounts, removals and settings" },
  { id: "menu", label: "Menus" },
  { id: "menu_photo", label: "Dish photo decisions" },
  { id: "menu_needed_by", label: "Needed-by dates" },
  { id: "area_photo", label: "Area photo decisions" },
  { id: "coverage", label: "Checklists and grants" },
  { id: "coverage_review", label: "Checklist photo decisions" },
  { id: "knowledge", label: "Venue facts" },
  { id: "amenity", label: "Venue checks" },
  { id: "labels", label: "Photo labels" },
  { id: "album_place", label: "Album places" },
  { id: "album_brief", label: "Briefs" },
] as const

export type ActivitySource = (typeof ACTIVITY_SOURCES)[number]["id"]

export function isActivitySource(v: unknown): v is ActivitySource {
  return ACTIVITY_SOURCES.some((s) => s.id === v)
}

const str = (v: unknown) => (typeof v === "string" ? v : null)
const int = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) ? v : null

export function parseCursor(v: unknown): ActivityCursor | null {
  if (!v || typeof v !== "object") return null
  const c = v as Record<string, unknown>
  const at = str(c.at)
  const source = str(c.source)
  const id = int(c.id)
  return at && source && id !== null ? { at, source, id } : null
}

export function parseActivityPage(data: unknown): ActivityPage | null {
  if (!data || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.items)) return null
  const items = d.items.flatMap((raw): ActivityItem[] => {
    const r = raw as Record<string, unknown>
    const source = str(r.source)
    const id = int(r.id)
    const at = str(r.at)
    const action = str(r.action)
    if (!source || id === null || !at || !action) return []
    return [
      {
        source,
        id,
        at,
        actorId: str(r.actorId),
        actorName: str(r.actorName),
        actorRole: str(r.actorRole) ?? "system",
        venueId: str(r.venueId),
        venueName: str(r.venueName),
        action,
        objectType: str(r.objectType) ?? "",
        objectId: str(r.objectId),
        oldRevision: int(r.oldRevision),
        newRevision: int(r.newRevision),
        reason: str(r.reason),
      },
    ]
  })
  return { items, nextCursor: parseCursor(d.nextCursor) }
}

/**
 * The cursor as one token for the URL ("id.source.at"), and back (null when
 * it is not one). Sources have no dots; the time may, so it comes last.
 */
export function encodeCursor(cursor: ActivityCursor): string {
  return `${cursor.id}.${cursor.source}.${cursor.at}`
}

export function decodeCursor(token: string | undefined): ActivityCursor | null {
  if (!token || token.length > 200) return null
  const match = /^(\d{1,18})\.([a-z_]{1,40})\.(.+)$/.exec(token)
  if (!match || Number.isNaN(Date.parse(match[3]))) return null
  return { id: Number(match[1]), source: match[2], at: match[3] }
}

const ACTION_WORDS: Record<string, string> = {
  account_deactivated: "Deactivated an account",
  account_reactivated: "Reactivated an account",
  account_role_changed: "Changed an account's role",
  account_venue_changed: "Moved an account to another venue",
  membership_added: "Added someone to a venue",
  membership_ended: "Ended someone's place at a venue",
  media_removed: "Removed a photo or video",
  library_asset_suspended: "Suspended a photo from use",
  settings_changed: "Changed settings",
  accepted: "Accepted a photo",
  better_photo_requested: "Asked for another photo",
  needs_another_photo: "Asked for another photo",
  withdrawn: "Withdrew a photo",
  primary_set: "Chose the main photo",
  primary_cleared: "Cleared the main photo",
  activated: "Made a menu current",
  retired: "Retired a menu",
  draft_created: "Started a menu draft",
  labels_saved: "Saved photo labels",
  place_set: "Placed a group in the album",
  place_cleared: "Cleared a group's place",
  brief_set: "Wrote a brief",
  brief_cleared: "Cleared a brief",
  needed_by_set: "Set a needed-by date",
  needed_by_cleared: "Cleared a needed-by date",
}

/** Plain words for an action; unknown actions read as their own name. */
export function actionWords(action: string): string {
  const known = ACTION_WORDS[action]
  if (known) return known
  const words = action.replaceAll("_", " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function sourceWords(source: string): string {
  return ACTIVITY_SOURCES.find((s) => s.id === source)?.label ?? source
}

/** "rev 3 → 4", "rev 4", or null. */
export function revisionText(item: ActivityItem): string | null {
  if (item.oldRevision !== null && item.newRevision !== null)
    return `rev ${item.oldRevision} → ${item.newRevision}`
  if (item.newRevision !== null) return `rev ${item.newRevision}`
  return null
}
