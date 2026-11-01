import type {
  MenuDocument,
  MenuDocItem,
  MenuDiff,
  DiffChange,
  ReviewDecision,
} from "@/lib/menus/types"
const flat = (d: MenuDocument | null) =>
  d?.sections.flatMap((s) =>
    s.items.map((item) => ({
      item,
      sectionName: s.name,
      slug: s.slug,
      kind: s.kind,
    }))
  ) ?? []
const nameKey = (s: string) =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
const variantKey = (s: string) => s.trim().toLowerCase()
const ref = (r: ReturnType<typeof flat>[number]) => ({
  sourceKey: r.item.sourceKey,
  itemId: r.item.itemId,
  name: r.item.name,
  sectionName: r.sectionName,
})
function variants(item: MenuDocItem, base: MenuDocItem): boolean {
  let ambiguous = false
  item.variants = item.variants.map((v) => {
    const matches = base.variants.filter(
      (b) => variantKey(b.name) === variantKey(v.name)
    )
    if (matches.length > 1) ambiguous = true
    return {
      ...v,
      variantId: matches.length === 1 ? matches[0].variantId : null,
    }
  })
  return ambiguous
}
const REVIEW_MAX_CANDIDATES = 20
const REVIEW_REASON_MAX = 200
const truncate = (text: string, max: number) => {
  const chars = [...text]
  return chars.length <= max ? text : chars.slice(0, max - 1).join("") + "…"
}
export function matchImportToBase(
  base: MenuDocument | null,
  incoming: MenuDocument
): MenuDocument {
  const doc = structuredClone(incoming),
    old = flat(base),
    keys = new Set(flat(doc).map((r) => r.item.sourceKey))
  const candidates = old.filter((r) => !keys.has(r.item.sourceKey))
  for (const { item } of flat(doc)) {
    item.itemId = null
    item.review = null
    item.variants.forEach((v) => (v.variantId = null))
    const exact = old.find((r) => r.item.sourceKey === item.sourceKey)
    if (exact) {
      item.itemId = exact.item.itemId
      if (variants(item, exact.item))
        item.review = {
          candidates: exact.item.itemId ? [exact.item.itemId] : [],
          reason:
            "Duplicate base variant names; resolve variants before activation",
        }
      continue
    }
    const names = [item.name, ...item.aliases].map(nameKey)
    const found = candidates.filter(
      (r) => r.item.itemId && names.includes(nameKey(r.item.name))
    )
    if (found.length) {
      // Bounded to the save contract (≤20 candidates, ≤200-char reason; final
      // review I-4). Candidate names are shown from the diff, not the reason.
      const shown = found.slice(0, REVIEW_MAX_CANDIDATES)
      const reason =
        found.length > shown.length
          ? `Same name as ${found.length} existing items (first ${shown.length} listed); confirm one of them or treat it as a new dish`
          : found.length === 1
            ? `Same name as an existing item in ${shown[0].sectionName}; confirm it is the same dish or a new one`
            : `Same name as ${found.length} existing items; confirm which one it is or treat it as a new dish`
      item.review = {
        candidates: shown.map((r) => r.item.itemId!),
        reason: truncate(reason, REVIEW_REASON_MAX),
      }
    }
  }
  return doc
}
export function applyReviewDecision(
  document: MenuDocument,
  sourceKey: string,
  decision: ReviewDecision,
  base?: MenuDocument
): MenuDocument {
  const doc = structuredClone(document)
  const item = flat(doc).find((r) => r.item.sourceKey === sourceKey)?.item
  if (!item) throw Error("Unknown source key")
  if (decision.kind === "same") {
    if (!item.review?.candidates.includes(decision.itemId))
      throw Error("Identity must be a review candidate")
    const previous = flat(base ?? null).find(
      (r) => r.item.itemId === decision.itemId
    )?.item
    item.itemId = decision.itemId
    item.variants.forEach((v) => (v.variantId = null))
    if (previous && variants(item, previous))
      throw Error("Duplicate base variant names must be resolved")
  } else {
    item.itemId = null
    item.variants.forEach((v) => (v.variantId = null))
  }
  item.review = null
  return doc
}
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => equal(x, b[i]))
  if (a && b && typeof a === "object" && typeof b === "object") {
    const x = a as Record<string, unknown>,
      y = b as Record<string, unknown>
    return (
      Object.keys(x).length === Object.keys(y).length &&
      Object.keys(x).every((k) => Object.hasOwn(y, k) && equal(x[k], y[k]))
    )
  }
  return false
}
export function diffMenuDocuments(
  base: MenuDocument | null,
  next: MenuDocument
): MenuDiff {
  const result: MenuDiff = {
    added: [],
    changed: [],
    removed: [],
    uncertain: [],
    unchangedCount: 0,
  }
  const old = flat(base),
    rows = flat(next),
    ids = new Set(rows.map((r) => r.item.itemId))
  for (const r of rows) {
    const i = r.item
    if (i.review) {
      result.uncertain.push({
        ...ref(r),
        candidates: old
          .filter(
            (b) => b.item.itemId && i.review!.candidates.includes(b.item.itemId)
          )
          .map((b) => ({ ...ref(b), itemId: b.item.itemId! })),
        reason: i.review.reason,
      })
      continue
    }
    if (!i.itemId) {
      result.added.push(ref(r))
      continue
    }
    const b = old.find((b) => b.item.itemId === i.itemId)
    if (!b) {
      result.added.push(ref(r))
      continue
    }
    const fields: string[] = [],
      before: DiffChange["before"] = {}
    for (const k of ["name", "description", "aliases"] as const) {
      if (!equal(i[k], b.item[k])) {
        fields.push(k)
        Object.assign(before, { [k]: b.item[k] })
      }
    }
    if (
      r.sectionName !== b.sectionName ||
      r.slug !== b.slug ||
      r.kind !== b.kind
    ) {
      fields.push("section")
      before.sectionName = b.sectionName
    }
    if (!equal(i.variants, b.item.variants)) {
      fields.push("variants")
      before.variants = b.item.variants.map((v) => v.name)
    }
    if (!equal(i.sourceMeta, b.item.sourceMeta)) {
      fields.push("meta")
      Object.assign(before, { meta: b.item.sourceMeta })
    }
    if (fields.length) result.changed.push({ ...ref(r), fields, before })
    else result.unchangedCount++
  }
  result.removed = old
    .filter((r) => r.item.itemId && !ids.has(r.item.itemId))
    .map((r) => ({ ...ref(r), itemId: r.item.itemId! }))
  return result
}
