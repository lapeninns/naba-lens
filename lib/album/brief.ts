// Shot templates and slot briefs (FA-52; spec §8 A7, §5.2 step 2, §11).
// Pure and server-safe: the album loader, the request form and Settings all
// read these shapes.
//
// A slot's brief is resolved once, in the database (public.slot_briefs,
// 20261118134000_shot_templates.sql), in this order:
//   1 request    the brief of an open request on the slot
//   2 manager    the dish's own brief, else its section's (album_briefs)
//   3 catalogue  a facility question's capture brief (amenity_catalogue)
//   4 template   the category's shot template (Settings › Shot templates)
// The example photo is the request's reference when the brief is the
// request's, else the category template's example.

import {
  BRIEF_MAX,
  COVERAGE_CATEGORIES,
  isBriefText,
  type CoverageCategory,
  type CoverageSlotKind,
} from "@/lib/album/model"

export type SlotBriefSource = "request" | "manager" | "catalogue" | "template"

export type ResolvedBrief = {
  text: string
  source: SlotBriefSource
  /** An approved example photo, or null. */
  exampleAssetId: string | null
}

/** Resolved briefs keyed as Album's slot ids: "dish:<id>", "area:<id>". */
export type SlotBriefs = ReadonlyMap<string, ResolvedBrief>

export type ShotTemplate = {
  category: CoverageCategory
  instruction: string
  /** Shown only while it is a public-level, usable Library photo. */
  exampleAssetId: string | null
  revision: number
  /** Admins: a stored example that no longer qualifies and is not shown. */
  exampleUnavailable?: boolean
  updatedAt?: string | null
  updatedBy?: string | null
}

export type ExampleChoice = {
  assetId: string
  venueId: string
  venueName: string
  uploadedAt: string
}

/** The template limit is the album brief's: one line (DESIGN.md §5 Brief). */
export const SHOT_TEMPLATE_MAX = BRIEF_MAX

export const isShotTemplateText = isBriefText

const SOURCES: ReadonlySet<string> = new Set([
  "request",
  "manager",
  "catalogue",
  "template",
])
const KINDS: ReadonlySet<string> = new Set(["dish", "amenity", "area"])
const CATEGORY_KEYS: ReadonlySet<string> = new Set(
  COVERAGE_CATEGORIES.map((c) => c.key)
)

const str = (v: unknown) => (typeof v === "string" && v ? v : null)
const list = (data: unknown, key?: string): Record<string, unknown>[] => {
  const value = key ? (data as Record<string, unknown> | null)?.[key] : data
  return Array.isArray(value)
    ? value.filter(
        (r): r is Record<string, unknown> => !!r && typeof r === "object"
      )
    : []
}

export const slotBriefKey = (kind: CoverageSlotKind, slotId: string) =>
  `${kind}:${slotId}`

/** public.slot_briefs as a lookup; null when the payload is not one. */
export function parseSlotBriefs(data: unknown): SlotBriefs | null {
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as { items?: unknown }).items)
  )
    return null
  const out = new Map<string, ResolvedBrief>()
  for (const row of list(data, "items")) {
    const kind = str(row.kind)
    const slotId = str(row.slotId)
    const text = str(row.brief)
    const source = str(row.source)
    if (!kind || !KINDS.has(kind) || !slotId || !text) continue
    if (!source || !SOURCES.has(source)) continue
    out.set(slotBriefKey(kind as CoverageSlotKind, slotId), {
      text,
      source: source as SlotBriefSource,
      exampleAssetId: str(row.exampleAssetId),
    })
  }
  return out
}

/** public.shot_templates in category order; null when it is not a list. */
export function parseShotTemplates(data: unknown): ShotTemplate[] | null {
  if (!Array.isArray(data)) return null
  const found = new Map<CoverageCategory, ShotTemplate>()
  for (const row of list(data)) {
    const category = str(row.category)
    const instruction = str(row.instruction)
    const revision = Number(row.revision)
    if (!category || !CATEGORY_KEYS.has(category) || !instruction) continue
    if (!Number.isInteger(revision) || revision < 1) continue
    found.set(category as CoverageCategory, {
      category: category as CoverageCategory,
      instruction,
      exampleAssetId: str(row.exampleAssetId),
      revision,
      ...(typeof row.exampleUnavailable === "boolean"
        ? { exampleUnavailable: row.exampleUnavailable }
        : {}),
      ...("updatedAt" in row ? { updatedAt: str(row.updatedAt) } : {}),
      ...("updatedBy" in row ? { updatedBy: str(row.updatedBy) } : {}),
    })
  }
  return COVERAGE_CATEGORIES.flatMap(({ key }) => {
    const t = found.get(key)
    return t ? [t] : []
  })
}

/** public.shot_template_example_choices; null when it is not one. */
export function parseExampleChoices(
  data: unknown
): {
  items: ExampleChoice[]
  nextCursor: { at: string; id: string } | null
} | null {
  if (!data || typeof data !== "object") return null
  const items = list(data, "items").flatMap((row): ExampleChoice[] => {
    const assetId = str(row.assetId)
    const venueId = str(row.venueId)
    const uploadedAt = str(row.uploadedAt)
    if (!assetId || !venueId || !uploadedAt) return []
    return [
      { assetId, venueId, venueName: str(row.venueName) ?? "", uploadedAt },
    ]
  })
  const cursor = (data as { nextCursor?: unknown }).nextCursor as
    Record<string, unknown> | null | undefined
  const at = str(cursor?.at)
  const id = str(cursor?.id)
  return { items, nextCursor: at && id ? { at, id } : null }
}

/** The category's label ("Food"), for Settings and the activity log. */
export function categoryLabel(category: CoverageCategory): string {
  return COVERAGE_CATEGORIES.find((c) => c.key === category)?.label ?? category
}

export const isCoverageCategory = (v: unknown): v is CoverageCategory =>
  typeof v === "string" && CATEGORY_KEYS.has(v)
