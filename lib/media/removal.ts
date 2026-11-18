/*
 * Removing media (FA-21, spec §3.3, §16). Accepted originals are kept: their
 * uploader or the venue's manager asks for removal, and an admin removes one
 * with a reason after an impact preview, never while it is published. Shapes
 * of the database's JSON (20261118107100_media_removal.sql) and their
 * parsers; no server code, so screens can import the types.
 */

export type RemovalRequestState =
  "open" | "completed" | "declined" | "cancelled"

export const REMOVAL_REQUEST_STATES: readonly RemovalRequestState[] = [
  "open",
  "completed",
  "declined",
  "cancelled",
]

export type RemovalImpact = {
  assetId: string
  venueId: string
  uploaderId: string
  /** Already removed: nothing more to do. */
  removed: boolean
  /** Accepted somewhere, so only an admin may remove it. */
  accepted: boolean
  menuItems: {
    itemId: string
    name: string
    state: string
    isPrimary: boolean
  }[]
  areas: { subjectId: string; label: string; state: string }[]
  coverageSends: number
  amenityAnswers: number
  /** Active public use grants: removal is refused until they are withdrawn. */
  publicUses: number
  internalUses: number
  openRequests: number
  /** Accepted amenity photo reviews (S2-INT, review R2). */
  amenityPhotos: number
  /** Area and amenity slots whose current primary it is. */
  primaryChoices: number
  /**
   * Destinations where it is recorded as published (or the withdrawal is
   * not yet confirmed): removal is refused until they are withdrawn (R22).
   */
  publications: number
  /** True while publicUses > 0 or publications > 0. */
  blocked: boolean
  /** Pass back to the removal: it fails if any of the above has changed. */
  token: string
}

export type RemovalRequest = {
  requestId: string
  assetId: string
  venueId: string
  venueName: string
  requestedBy: string
  requesterName: string
  reason: string
  state: RemovalRequestState
  createdAt: string
  decidedAt: string | null
  decisionReason: string | null
  /** The caller made this request (and may cancel it while open). */
  mine: boolean
}

/** Reasons are 3 to 500 characters after trimming, as the database checks. */
export function normaliseRemovalReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const reason = raw.trim()
  return reason.length >= 3 && reason.length <= 500 ? reason : null
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null
const str = (v: unknown): v is string => typeof v === "string"
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null
}

/** `media_removal_impact`; null when the shape is not one this app knows. */
export function parseRemovalImpact(value: unknown): RemovalImpact | null {
  const raw = obj(value)
  if (!raw) return null
  const menuItems: RemovalImpact["menuItems"] = []
  const areas: RemovalImpact["areas"] = []
  if (!Array.isArray(raw.menuItems) || !Array.isArray(raw.areas)) return null
  for (const entry of raw.menuItems) {
    const m = obj(entry)
    if (!m || !str(m.itemId) || !str(m.name) || !str(m.state)) return null
    menuItems.push({
      itemId: m.itemId,
      name: m.name,
      state: m.state,
      isPrimary: m.isPrimary === true,
    })
  }
  for (const entry of raw.areas) {
    const a = obj(entry)
    if (!a || !str(a.subjectId) || !str(a.label) || !str(a.state)) return null
    areas.push({ subjectId: a.subjectId, label: a.label, state: a.state })
  }
  const counts = [
    "coverageSends",
    "amenityAnswers",
    "publicUses",
    "internalUses",
    "openRequests",
  ].map((key) => num(raw[key]))
  if (counts.some((n) => n === null)) return null
  if (
    !str(raw.assetId) ||
    !str(raw.venueId) ||
    !str(raw.uploaderId) ||
    !str(raw.token)
  )
    return null
  const [
    coverageSends,
    amenityAnswers,
    publicUses,
    internalUses,
    openRequests,
  ] = counts as number[]
  return {
    assetId: raw.assetId,
    venueId: raw.venueId,
    uploaderId: raw.uploaderId,
    removed: raw.removed === true,
    accepted: raw.accepted === true,
    menuItems,
    areas,
    coverageSends: coverageSends!,
    amenityAnswers: amenityAnswers!,
    publicUses: publicUses!,
    internalUses: internalUses!,
    openRequests: openRequests!,
    // Older servers did not send these three; read them as none.
    amenityPhotos: num(raw.amenityPhotos) ?? 0,
    primaryChoices: num(raw.primaryChoices) ?? 0,
    publications: num(raw.publications) ?? 0,
    blocked: raw.blocked === true,
    token: raw.token,
  }
}

/** `media_removal_requests`: rows this app cannot read are left out. */
export function parseRemovalRequests(value: unknown): RemovalRequest[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const r = obj(entry)
    const state = REMOVAL_REQUEST_STATES.find((s) => s === r?.state)
    if (
      !r ||
      !state ||
      !str(r.requestId) ||
      !str(r.assetId) ||
      !str(r.venueId) ||
      !str(r.venueName) ||
      !str(r.requestedBy) ||
      !str(r.requesterName) ||
      !str(r.reason) ||
      !str(r.createdAt)
    )
      return []
    return [
      {
        requestId: r.requestId,
        assetId: r.assetId,
        venueId: r.venueId,
        venueName: r.venueName,
        requestedBy: r.requestedBy,
        requesterName: r.requesterName,
        reason: r.reason,
        state,
        createdAt: r.createdAt,
        decidedAt: str(r.decidedAt) ? r.decidedAt : null,
        decisionReason: str(r.decisionReason) ? r.decisionReason : null,
        mine: r.mine === true,
      },
    ]
  })
}
