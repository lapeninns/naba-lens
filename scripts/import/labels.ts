/**
 * Legacy label matching (FA-54, spec §20 steps 2 and 7). A legacy label is
 * staged for review only when it names exactly one current subject at the
 * venue: a dish on the active menu (its name or an alias), a place that is
 * not retired, or an active amenity check (its key, read as words: "pool
 * table" for pool_table). No match, or more than one, leaves the photo
 * unlabelled with the legacy label kept as its note. Never a fuzzy guess.
 * Pure: no database access.
 */

export type SubjectKind = "dish" | "place" | "amenity"

export type LabelCandidate = {
  kind: SubjectKind
  id: string
  /** Every name the subject answers to (dish name and aliases, place label, amenity words). */
  names: string[]
}

export type LabelMatch =
  | { state: "matched"; kind: SubjectKind; id: string }
  | { state: "none" }
  | { state: "ambiguous"; count: number }
  | { state: "no_label" }

/**
 * Lower case, `&` as "and", punctuation and underscores as spaces, accents
 * removed, runs of spaces collapsed. "Fish & Chips!" and "fish and chips"
 * are the same label; "Fish" and "Fish and chips" are not.
 */
export function normaliseLabel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** An amenity key as words: pool_table -> "pool table". */
export const amenityWords = (key: string) => key.replace(/_/g, " ")

export function matchLegacyLabel(
  label: string | null | undefined,
  candidates: readonly LabelCandidate[]
): LabelMatch {
  const wanted = normaliseLabel(label ?? "")
  if (!wanted) return { state: "no_label" }
  const hits = new Map<string, LabelCandidate>()
  for (const candidate of candidates) {
    if (candidate.names.some((name) => normaliseLabel(name) === wanted)) {
      hits.set(`${candidate.kind}:${candidate.id}`, candidate)
    }
  }
  if (hits.size === 0) return { state: "none" }
  if (hits.size > 1) return { state: "ambiguous", count: hits.size }
  const only = [...hits.values()][0]!
  return { state: "matched", kind: only.kind, id: only.id }
}
