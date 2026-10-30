// Pure MenuDocument edits used by MenuDocumentEditor. Every function returns a
// new document and never changes an existing itemId or variantId.

import {
  MENU_IMPORT_LIMITS,
  type ImportIssue,
  type MenuDocItem,
  type MenuDocSection,
  type MenuDocument,
  type MenuSectionKind,
} from "@/lib/menus/types"

function withSuffix(base: string, taken: Set<string>, max: number): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, max - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

export function allSourceKeys(doc: MenuDocument): Set<string> {
  return new Set(doc.sections.flatMap((s) => s.items.map((i) => i.sourceKey)))
}

function mapSection(
  doc: MenuDocument,
  slug: string,
  fn: (section: MenuDocSection) => MenuDocSection
): MenuDocument {
  return {
    ...doc,
    sections: doc.sections.map((s) => (s.slug === slug ? fn(s) : s)),
  }
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (index < 0 || target < 0 || target >= list.length) return list
  const next = list.slice()
  const [entry] = next.splice(index, 1)
  next.splice(target, 0, entry)
  return next
}

export function findItem(
  doc: MenuDocument,
  sourceKey: string
): { section: MenuDocSection; index: number; item: MenuDocItem } | null {
  for (const section of doc.sections) {
    const index = section.items.findIndex((i) => i.sourceKey === sourceKey)
    if (index >= 0) return { section, index, item: section.items[index] }
  }
  return null
}

export function addSection(
  doc: MenuDocument,
  name: string,
  kind: MenuSectionKind,
  slugify: (value: string) => string
): { doc: MenuDocument; slug: string } {
  const taken = new Set(doc.sections.map((s) => s.slug))
  const slug = withSuffix(slugify(name) || "section", taken, 80)
  return {
    doc: {
      ...doc,
      sections: [...doc.sections, { slug, name, kind, items: [] }],
    },
    slug,
  }
}

/** Renames keep the slug: it is the section's identity for labels/filters. */
export function updateSection(
  doc: MenuDocument,
  slug: string,
  patch: Partial<Pick<MenuDocSection, "name" | "kind">>
): MenuDocument {
  return mapSection(doc, slug, (s) => ({ ...s, ...patch }))
}

export function moveSection(
  doc: MenuDocument,
  slug: string,
  delta: number
): MenuDocument {
  const index = doc.sections.findIndex((s) => s.slug === slug)
  return { ...doc, sections: move(doc.sections, index, delta) }
}

export function removeSection(doc: MenuDocument, slug: string): MenuDocument {
  return { ...doc, sections: doc.sections.filter((s) => s.slug !== slug) }
}

/** New item: itemId null and a fresh, unique source key. */
export function addItem(
  doc: MenuDocument,
  sectionSlug: string,
  name: string,
  makeSourceKey: (sectionSlug: string, itemName: string) => string
): { doc: MenuDocument; sourceKey: string } {
  const max = MENU_IMPORT_LIMITS.sourceKeyMax
  const base = (makeSourceKey(sectionSlug, name) || `${sectionSlug}--item`)
    .toLowerCase()
    .slice(0, max)
  const sourceKey = withSuffix(base, allSourceKeys(doc), max)
  const item: MenuDocItem = {
    itemId: null,
    sourceKey,
    name,
    description: null,
    aliases: [],
    sourceMeta: {},
    variants: [],
    review: null,
  }
  return {
    doc: mapSection(doc, sectionSlug, (s) => ({
      ...s,
      items: [...s.items, item],
    })),
    sourceKey,
  }
}

/** Edits content fields only; ids and the source key are never patched. */
export function updateItem(
  doc: MenuDocument,
  sourceKey: string,
  patch: Partial<
    Pick<MenuDocItem, "name" | "description" | "aliases" | "variants">
  >
): MenuDocument {
  return {
    ...doc,
    sections: doc.sections.map((s) =>
      s.items.some((i) => i.sourceKey === sourceKey)
        ? {
            ...s,
            items: s.items.map((i) =>
              i.sourceKey === sourceKey ? { ...i, ...patch } : i
            ),
          }
        : s
    ),
  }
}

export function moveItem(
  doc: MenuDocument,
  sourceKey: string,
  delta: number
): MenuDocument {
  const found = findItem(doc, sourceKey)
  if (!found) return doc
  return mapSection(doc, found.section.slug, (s) => ({
    ...s,
    items: move(s.items, found.index, delta),
  }))
}

export function moveItemToSection(
  doc: MenuDocument,
  sourceKey: string,
  targetSlug: string
): MenuDocument {
  const found = findItem(doc, sourceKey)
  if (!found || found.section.slug === targetSlug) return doc
  if (!doc.sections.some((s) => s.slug === targetSlug)) return doc
  return {
    ...doc,
    sections: doc.sections.map((s) =>
      s.slug === found.section.slug
        ? { ...s, items: s.items.filter((i) => i.sourceKey !== sourceKey) }
        : s.slug === targetSlug
          ? { ...s, items: [...s.items, found.item] }
          : s
    ),
  }
}

export function removeItem(doc: MenuDocument, sourceKey: string): MenuDocument {
  return {
    ...doc,
    sections: doc.sections.map((s) =>
      s.items.some((i) => i.sourceKey === sourceKey)
        ? { ...s, items: s.items.filter((i) => i.sourceKey !== sourceKey) }
        : s
    ),
  }
}

/** Case-insensitive match on the item name or any alias. */
export function itemMatches(item: MenuDocItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    item.name.toLowerCase().includes(q) ||
    item.aliases.some((a) => a.toLowerCase().includes(q))
  )
}

const ISSUE_PATH = /^sections\[(\d+)\](?:\.items\[(\d+)\])?/

/** Source keys / section slugs that an issue path such as
 *  "sections[2].items[5].name" points at, for inline flags. */
export function locateIssues(
  doc: MenuDocument,
  paths: string[]
): { items: Set<string>; sections: Set<string> } {
  const items = new Set<string>()
  const sections = new Set<string>()
  for (const path of paths) {
    const m = ISSUE_PATH.exec(path)
    if (!m) continue
    const section = doc.sections[Number(m[1])]
    if (!section) continue
    if (m[2] === undefined) {
      sections.add(section.slug)
      continue
    }
    const item = section.items[Number(m[2])]
    if (item) items.add(item.sourceKey)
  }
  return { items, sections }
}

/**
 * Editor-side checks the database also enforces (amendment A1): two variants
 * of one item may not share a case-insensitive, trimmed name.
 */
export function editorIssues(doc: MenuDocument): ImportIssue[] {
  const issues: ImportIssue[] = []
  doc.sections.forEach((section, s) =>
    section.items.forEach((item, i) => {
      const seen = new Set<string>()
      const reported = new Set<string>()
      for (const variant of item.variants) {
        const key = variant.name.trim().toLowerCase()
        if (!key) continue
        if (seen.has(key) && !reported.has(key)) {
          reported.add(key)
          issues.push({
            severity: "error",
            path: `sections[${s}].items[${i}].variants`,
            message: `“${item.name}” has more than one variant called “${variant.name.trim()}”.`,
          })
        }
        seen.add(key)
      }
    })
  )
  return issues
}
