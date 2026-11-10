// The kind filter on /manager/review (UI design §6.2): Photos (today's
// queue), Findings (To confirm) or All. Each queue keeps the server's order;
// All only interleaves the two by waiting time.

export const REVIEW_KINDS = ["photos", "findings", "all"] as const
export type ReviewKind = (typeof REVIEW_KINDS)[number]

/** `?kind=`; anything else is Photos, today's default. */
export function reviewKindOf(value: unknown): ReviewKind {
  return typeof value === "string" &&
    (REVIEW_KINDS as readonly string[]).includes(value)
    ? (value as ReviewKind)
    : "photos"
}

export type Merged<P, F> =
  { kind: "photo"; value: P } | { kind: "finding"; value: F }

const time = (iso: string | null) => {
  const at = iso === null ? Number.NaN : Date.parse(iso)
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at
}

/**
 * Interleaves two oldest-first lists by when each started waiting, keeping
 * each list's own order (a merge, never a sort). When more photos exist than
 * were read, findings that waited longer than the last photo read are held
 * back rather than shown ahead of photos not yet read; `heldBack` counts them.
 */
export function mergeByWaiting<P, F>(
  photos: readonly P[],
  photoAt: (photo: P) => string | null,
  findings: readonly F[],
  findingAt: (finding: F) => string | null,
  morePhotos: boolean
): { entries: Merged<P, F>[]; heldBack: number } {
  const entries: Merged<P, F>[] = []
  let p = 0
  let f = 0
  while (p < photos.length && f < findings.length) {
    if (time(photoAt(photos[p])) <= time(findingAt(findings[f])))
      entries.push({ kind: "photo", value: photos[p++] })
    else entries.push({ kind: "finding", value: findings[f++] })
  }
  while (p < photos.length) entries.push({ kind: "photo", value: photos[p++] })
  const rest = findings.slice(f)
  if (morePhotos && photos.length > 0) {
    return { entries, heldBack: rest.length }
  }
  for (const value of rest) entries.push({ kind: "finding", value })
  return { entries, heldBack: 0 }
}
