// Pure in-browser search over one venue's active catalogue (a few hundred
// items at most). Matches item names, aliases, descriptions, section names
// and variant names; every query word must match somewhere.
//
// A work focus (lib/config/work-roles.ts) only changes order: sections that
// fit the person's work come first among equally good matches, and they feed
// the "Suggested" list shown before anything is typed. Search always covers
// the whole catalogue.

import type { WorkFocus } from "@/lib/config/work-roles"
import type {
  CatalogueItem,
  CatalogueSection,
  LabelCatalogue,
} from "@/lib/menus/types"

export type CatalogueHit = {
  item: CatalogueItem
  section: CatalogueSection
  /** The alias that matched when the name itself did not. */
  matchedAlias: string | null
}

type IndexEntry = {
  item: CatalogueItem
  section: CatalogueSection
  order: number
  /** Lower is closer to the person's work; NO_FOCUS when outside it. */
  focus: number
  name: string
  aliases: string[]
  rest: string
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export type CatalogueIndex = IndexEntry[]

const NO_FOCUS = 1000

/**
 * How closely a section fits a focus: keyword matches on the name or slug
 * first, then by section kind in focus order.
 */
export function sectionFocusRank(
  section: Pick<CatalogueSection, "name" | "slug" | "kind">,
  focus: WorkFocus | null | undefined
): number {
  if (!focus) return NO_FOCUS
  const names = [normalizeText(section.name), normalizeText(section.slug)]
  const words = names.join(" ").split(" ")
  if (
    focus.sectionKeywords.some((keyword) =>
      keyword.includes(" ")
        ? names.some((name) => ` ${name} `.includes(` ${keyword} `))
        : words.some((word) => word.startsWith(keyword))
    )
  )
    return 0
  const kind = focus.sectionKinds.indexOf(section.kind)
  return kind >= 0 ? 1 + kind : NO_FOCUS
}

export function buildCatalogueIndex(
  catalogue: LabelCatalogue | null,
  focus?: WorkFocus | null
): CatalogueIndex {
  if (catalogue?.status !== "active") return []
  const index: IndexEntry[] = []
  for (const section of catalogue.sections) {
    const rank = sectionFocusRank(section, focus)
    for (const item of section.items) {
      index.push({
        item,
        section,
        order: index.length,
        focus: rank,
        name: normalizeText(item.name),
        aliases: item.aliases.map(normalizeText),
        rest: normalizeText(
          [
            section.name,
            item.description ?? "",
            ...item.variants.map((v) => v.name),
          ].join(" ")
        ),
      })
    }
  }
  return index
}

function rank(entry: IndexEntry, query: string, words: string[]) {
  if (entry.name === query) return 0
  if (entry.name.startsWith(query)) return 1
  if (entry.name.includes(query)) return 2
  if (entry.aliases.some((a) => a.includes(query))) return 3
  if (words.every((w) => entry.name.includes(w))) return 4
  return 5
}

export function searchCatalogue(
  index: CatalogueIndex,
  rawQuery: string,
  limit = 40
): CatalogueHit[] {
  const query = normalizeText(rawQuery)
  if (!query) return []
  const words = query.split(" ")
  const scored: { entry: IndexEntry; score: number }[] = []
  for (const entry of index) {
    const haystack = [entry.name, ...entry.aliases, entry.rest].join(" ")
    if (!words.every((w) => haystack.includes(w))) continue
    scored.push({ entry, score: rank(entry, query, words) })
  }
  // Focus breaks ties only: a better match always comes first.
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.entry.focus - b.entry.focus ||
      a.entry.order - b.entry.order
  )
  return scored.slice(0, limit).map(({ entry }) => {
    const nameMatches = words.every((w) => entry.name.includes(w))
    const aliasIndex = nameMatches
      ? -1
      : entry.aliases.findIndex((a) => words.some((w) => a.includes(w)))
    return {
      item: entry.item,
      section: entry.section,
      matchedAlias: aliasIndex >= 0 ? entry.item.aliases[aliasIndex] : null,
    }
  })
}

/**
 * Items from the focus sections, closest first then in menu order, for the
 * list shown before anything is typed. Empty without a focus.
 */
export function suggestedItems(
  index: CatalogueIndex,
  limit = 8
): CatalogueHit[] {
  return index
    .filter((entry) => entry.focus < NO_FOCUS)
    .sort((a, b) => a.focus - b.focus || a.order - b.order)
    .slice(0, limit)
    .map((entry) => ({
      item: entry.item,
      section: entry.section,
      matchedAlias: null,
    }))
}
