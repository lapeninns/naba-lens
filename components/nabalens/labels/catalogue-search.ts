// Pure in-browser search over one venue's active catalogue (a few hundred
// items at most). Matches item names, aliases, descriptions, section names
// and variant names; every query word must match somewhere.

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

export function buildCatalogueIndex(
  catalogue: LabelCatalogue | null
): CatalogueIndex {
  if (catalogue?.status !== "active") return []
  const index: IndexEntry[] = []
  for (const section of catalogue.sections) {
    for (const item of section.items) {
      index.push({
        item,
        section,
        order: index.length,
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
  scored.sort((a, b) => a.score - b.score || a.entry.order - b.entry.order)
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
