// FA-9 single-reviewer venue (S3-R1 K6): the admin's view of the setting and
// the decisions people made on their own photos, read defensively. Pure, so
// tests/unit/single-reviewer.test.ts runs it without a database.

import { CHIP_STATES } from "@/components/nabalens/status-chip"

export type SelfDecisionSource = "dish" | "place" | "amenity" | "photo"

/** One decision someone made on their own photo at the venue. */
export type SelfDecision = {
  source: SelfDecisionSource
  action: string
  level: string | null
  reason: string | null
  subject: string | null
  assetId: string
  by: string
  at: string
}

export type ReviewSettings = {
  venueId: string
  singleReviewer: boolean
  /** The venue revision the setting is changed against. */
  revision: number
  selfDecisions: SelfDecision[]
}

const str = (v: unknown) => (typeof v === "string" ? v : null)
const SOURCES: readonly SelfDecisionSource[] = [
  "dish",
  "place",
  "amenity",
  "photo",
]

/** `admin_venue_review_settings`, or null when it has the wrong shape. */
export function parseReviewSettings(data: unknown): ReviewSettings | null {
  if (!data || typeof data !== "object") return null
  const row = data as Record<string, unknown>
  const venueId = str(row.venueId)
  if (
    !venueId ||
    typeof row.singleReviewer !== "boolean" ||
    typeof row.revision !== "number" ||
    !Array.isArray(row.selfDecisions)
  )
    return null
  const selfDecisions = row.selfDecisions.flatMap((raw): SelfDecision[] => {
    if (!raw || typeof raw !== "object") return []
    const d = raw as Record<string, unknown>
    const source = SOURCES.find((s) => s === d.source)
    const action = str(d.action)
    const assetId = str(d.assetId)
    const at = str(d.at)
    if (!source || !action || !assetId || !at) return []
    return [
      {
        source,
        action,
        level: str(d.level),
        reason: str(d.reason),
        subject: str(d.subject),
        assetId,
        by: str(d.by) ?? "Someone",
        at,
      },
    ]
  })
  return {
    venueId,
    singleReviewer: row.singleReviewer,
    revision: row.revision,
    selfDecisions,
  }
}

const SOURCE_WORDS: Record<SelfDecisionSource, string> = {
  dish: "Dish",
  place: "Place",
  amenity: "Amenity",
  photo: "Whole photo",
}

const ACTION_WORDS: Record<string, string> = {
  accepted: "Public use",
  level_set: "Level changed",
  primary_set: "Made main photo",
  // S3-R13: the manager review word for a retake (status-chip.tsx).
  better_photo_requested: CHIP_STATES.coverage_replacement_needed.word,
  needs_another_photo: CHIP_STATES.coverage_replacement_needed.word,
  withdrawn: "Withdrawn",
  not_used: "Not used",
  duplicate: "Marked duplicate",
  restored: "Used again",
  pending: "Used again",
}

/** "Dish · Approved · Pie" for one self decision. */
export function selfDecisionWords(d: SelfDecision): string {
  const action =
    d.action === "accepted" && d.level === "reference"
      ? "Kept as reference"
      : (ACTION_WORDS[d.action] ?? d.action)
  return [SOURCE_WORDS[d.source], action, d.subject].filter(Boolean).join(" · ")
}
