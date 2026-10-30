// Rebuilds a MenuDocument from catalogue rows, and small pure helpers around
// documents for the admin menu operations.

import type {
  MenuDocItem,
  MenuDocument,
  MenuSectionKind,
  SourceMeta,
} from "@/lib/menus/types"

export type SectionRow = {
  id: string
  slug: string
  name: string
  kind: string
  position: number
}

export type EntryRow = {
  id: string
  section_id: string
  item_id: string
  name: string
  description: string | null
  aliases: string[] | null
  source_key: string
  source_meta: unknown
  position: number
  needs_review: boolean
  review_candidates: string[] | null
  review_reason: string | null
  variants: { variant_id: string; name: string; position: number }[] | null
}

const KINDS: MenuSectionKind[] = ["food", "drinks", "other"]

const byPosition = <T extends { position: number }>(a: T, b: T) =>
  a.position - b.position

function sourceMeta(value: unknown): SourceMeta {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as SourceMeta)
    : {}
}

/**
 * Sections and entries in position order, with stable item/variant ids and
 * the stored review (needs_review → candidates + reason).
 */
export function buildDocument(
  title: string,
  sections: SectionRow[],
  entries: EntryRow[]
): MenuDocument {
  const bySection = new Map<string, EntryRow[]>()
  for (const entry of entries) {
    const list = bySection.get(entry.section_id) ?? []
    list.push(entry)
    bySection.set(entry.section_id, list)
  }
  return {
    title,
    sections: [...sections].sort(byPosition).map((s) => ({
      slug: s.slug,
      name: s.name,
      kind: (KINDS as string[]).includes(s.kind)
        ? (s.kind as MenuSectionKind)
        : "other",
      items: (bySection.get(s.id) ?? [])
        .sort(byPosition)
        .map((e): MenuDocItem => ({
          itemId: e.item_id,
          sourceKey: e.source_key,
          name: e.name,
          description: e.description,
          aliases: e.aliases ?? [],
          sourceMeta: sourceMeta(e.source_meta),
          variants: [...(e.variants ?? [])]
            .sort(byPosition)
            .map((v) => ({ variantId: v.variant_id, name: v.name })),
          review: e.needs_review
            ? {
                candidates: e.review_candidates ?? [],
                reason: e.review_reason ?? "Needs review",
              }
            : null,
        })),
    })),
  }
}

/**
 * The part of `base` that review decisions need: only the items named as a
 * candidate somewhere in `document` (applyReviewDecision reads their variant
 * ids). Keeps the payload sent to the browser small.
 */
export function reviewBaseFor(
  base: MenuDocument | null,
  document: MenuDocument
): MenuDocument | null {
  if (!base) return null
  const wanted = new Set<string>()
  for (const s of document.sections)
    for (const i of s.items) i.review?.candidates.forEach((c) => wanted.add(c))
  return {
    title: base.title,
    sections: base.sections
      .map((s) => ({
        ...s,
        items: s.items.filter((i) => i.itemId && wanted.has(i.itemId)),
      }))
      .filter((s) => s.items.length > 0),
  }
}

/** Labels per item id from media_label_items rows. */
export function countByItem(
  rows: { item_id: string }[]
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.item_id] = (counts[r.item_id] ?? 0) + 1
  return counts
}

/** A copy for a new draft: ids kept, no reviews, nothing shared by reference. */
export function copyForDraft(document: MenuDocument): MenuDocument {
  const copy = structuredClone(document)
  for (const s of copy.sections) for (const i of s.items) i.review = null
  return copy
}

export function countItems(document: MenuDocument): number {
  return document.sections.reduce((n, s) => n + s.items.length, 0)
}
