// Album shelves (DESIGN.md §5d, D16): the album browsed by type, then shelf,
// then section. Naba-Lens ships one fixed shelf set; a menu section is put on
// a shelf by words in its name, and a venue's manager can move it
// (public.album_shelves). Code never lists menu items or section names.
// Pure and server-safe: the loader, the screens and the tests share it.

import {
  AREA_GROUP,
  COVERAGE_CATEGORIES,
  isCounted,
  isEmpty,
  isWaiting,
  sortSlots,
  type AlbumPlace,
  type AlbumSlot,
  type AlbumView,
  type CoverageCategory,
} from "@/lib/album/model"

export type ShelfDef = {
  key: string
  label: string
  /** Words in a section's name that put it here (normalised, lower case). */
  words?: RegExp
}

/** The fixed shelves of each type with word rules, checked in this order. */
export const SHELVES: Readonly<Record<"food" | "drinks", ShelfDef[]>> = {
  food: [
    {
      key: "food.starters",
      label: "Starters & small plates",
      words:
        /\b(starters?|small plates?|nibbles?|sharers?|sharing|tapas|appeti[sz]ers?|soups?|chaats?|momos?)\b/,
    },
    {
      key: "food.mains",
      label: "Mains",
      words:
        /\b(mains?|curr(y|ies)|clay oven|tandoori?|grills?|biryanis?|chow ?mein|noodles?|pub|classics?|burgers?|pizzas?|pasta|steaks?|roasts?|fish|pies?|platters?|thalis?|karahis?|sizzlers?|wraps?|sandwich(es)?|grub)\b/,
    },
    {
      key: "food.sides",
      label: "Rice, breads & sides",
      words:
        /\b(rice|naans?|breads?|rotis?|parathas?|sides?|fries|chips|salads?|accompaniments?|pickles?|chutneys?|raitas?|sauces?|extras?)\b/,
    },
    {
      key: "food.specials",
      label: "Specials",
      words:
        /\b(specials?|chefs?|selections?|house|seasonal|signatures?|today)\b/,
    },
    {
      key: "food.kids",
      label: "Kids",
      words: /\b(kids?|childrens?|little ones?|junior)\b/,
    },
    {
      key: "food.desserts",
      label: "Desserts",
      words: /\b(desserts?|puddings?|sweets?|ice creams?|afters)\b/,
    },
    { key: "food.more", label: "More food" },
  ],
  drinks: [
    {
      key: "drinks.beer",
      label: "Beer & cider",
      words:
        /\b(beers?|lagers?|ales?|ciders?|draught|draft|stouts?|bitters?|ipas?)\b/,
    },
    {
      key: "drinks.wine",
      label: "Wine & fizz",
      words:
        /\b(wines?|fizz|sparkling|prosecco|champagnes?|cava|rose|port|sherry|bubbles)\b/,
    },
    {
      key: "drinks.spirits",
      label: "Spirits",
      words:
        /\b(gins?|vodkas?|rums?|whiske?ys?|whiskies|brandy|brandies|cognacs?|tequilas?|mezcals?|liqueurs?|shots?|spirits?|bourbons?|scotch)\b/,
    },
    {
      key: "drinks.cocktails",
      label: "Cocktails & jugs",
      words: /\b(cocktails?|mocktails?|jugs?|pitchers?|spritz(es)?|punch)\b/,
    },
    {
      key: "drinks.soft",
      label: "Soft & hot drinks",
      words:
        /\b(soft|juices?|waters?|mixers?|hot|teas?|coffees?|cordials?|milkshakes?|lassis?|smoothies?|minerals?)\b/,
    },
    { key: "drinks.more", label: "More drinks" },
  ],
}

/** The one shelf of a type that has no word rules. */
const SINGLE: Readonly<Record<"spaces" | "other", ShelfDef>> = {
  spaces: { key: "spaces.venue", label: "The venue" },
  other: { key: "other", label: "Other" },
}

/** Lower case, accents off, "&" and punctuation as spaces. */
export function normaliseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * The order the word rules are checked in, when it differs from the shelves'
 * order on screen: the narrower shelf first, so "Kids burgers" is Kids and
 * "Gin cocktails" is Cocktails (§5d).
 */
const MATCH_ORDER: Readonly<Record<"food" | "drinks", readonly string[]>> = {
  food: [
    "food.kids",
    "food.desserts",
    "food.starters",
    "food.mains",
    "food.sides",
    "food.specials",
  ],
  drinks: [
    "drinks.cocktails",
    "drinks.beer",
    "drinks.wine",
    "drinks.spirits",
    "drinks.soft",
  ],
}

/** The shelf a section's name suggests within its type (§5d). */
export function suggestShelf(category: "food" | "drinks", name: string) {
  const words = normaliseName(name)
  const shelves = SHELVES[category]
  const hit = MATCH_ORDER[category]
    .map((key) => shelves.find((s) => s.key === key)!)
    .find((s) => s.words?.test(words))
  return (hit ?? shelves.at(-1)!).key
}

/** A shelf key a manager may choose for a section of this type. */
export function isShelfOf(category: CoverageCategory, key: string): boolean {
  return (
    (category === "food" || category === "drinks") &&
    SHELVES[category].some((s) => s.key === key)
  )
}

const AMENITY_SHELF = "facilities."

/** Which shelf a slot sits on, and that shelf's label. */
export function shelfOf(
  slot: AlbumSlot,
  chosen: ReadonlyMap<string, string>
): ShelfDef {
  const category = slot.category
  if (category === "food" || category === "drinks") {
    const own = slot.sectionKey ? chosen.get(slot.sectionKey) : undefined
    const key =
      own && isShelfOf(category, own) ? own : suggestShelf(category, slot.group)
    return SHELVES[category].find((s) => s.key === key)!
  }
  if (category === "facilities")
    return { key: `${AMENITY_SHELF}${slot.group}`, label: slot.group }
  return category === "spaces" ? SINGLE.spaces : SINGLE.other
}

// ---- the view -----------------------------------------------------------------

export type Tally = {
  /** Every counted slot (§4 "Counts"). */
  total: number
  filled: number
  waiting: number
  empty: number
}

export type ShelfSection = Tally & {
  /** The section slug, amenity category or area group: unique in its shelf. */
  key: string
  name: string
  slots: AlbumSlot[]
}

export type Shelf = Tally & {
  key: string
  label: string
  sections: ShelfSection[]
  /** Up to four accepted photos, for the shelf's folder cover (§5d). */
  covers: string[]
}

export type AlbumType = Tally & {
  category: CoverageCategory
  label: string
  shelves: Shelf[]
  /** Up to four accepted photos, for the type's strip on the landing. */
  covers: string[]
}

export type ShelfView = Tally & { types: AlbumType[] }

/** The lens: every place, one place, or Not placed yet. */
export type PlaceLens = string | "unplaced" | null

/** Up to four accepted photos, for a cover or a strip. */
function coversOf(slots: readonly AlbumSlot[]): string[] {
  return slots
    .filter((s) => s.state === "accepted" && s.thumbnailUrl)
    .slice(0, 4)
    .map((s) => s.thumbnailUrl!)
}

function tally(slots: readonly AlbumSlot[]): Tally {
  const counted = slots.filter(isCounted)
  return {
    total: counted.length,
    filled: counted.filter((s) => s.state === "accepted").length,
    waiting: counted.filter((s) => isWaiting(s.state)).length,
    empty: counted.filter((s) => isEmpty(s.state)).length,
  }
}

/** The places the lens takes slots from. */
function lensPlaces(view: AlbumView, lens: PlaceLens): AlbumPlace[] {
  const all = [...view.places, ...(view.unplaced ? [view.unplaced] : [])]
  if (lens === null) return all
  return all.filter((p) => (p.subjectId ?? "unplaced") === lens)
}

/**
 * The album as types, shelves and sections under a place lens (§5d).
 * `sectionOrder` is the active menu's section slugs in menu order; sections
 * keep that order within a shelf, others (amenity categories) go by name.
 * `amenityOrder` is the catalogue's category order for Facilities' shelves.
 */
export function buildShelves(
  view: AlbumView,
  options: {
    chosen?: ReadonlyMap<string, string>
    lens?: PlaceLens
    sectionOrder?: readonly string[]
    amenityOrder?: readonly string[]
  } = {}
): ShelfView {
  const chosen = options.chosen ?? new Map<string, string>()
  const sectionRank = new Map(
    (options.sectionOrder ?? []).map((slug, i) => [slug, i])
  )
  const amenityRank = new Map(
    (options.amenityOrder ?? []).map((name, i) => [name, i])
  )
  const slots = lensPlaces(view, options.lens ?? null).flatMap((p) =>
    p.groups.flatMap((g) => g.slots)
  )

  type Bucket = { def: ShelfDef; sections: Map<string, AlbumSlot[]> }
  const byType = new Map<CoverageCategory, Map<string, Bucket>>()
  for (const slot of slots) {
    const def = shelfOf(slot, chosen)
    const shelves = byType.get(slot.category) ?? new Map<string, Bucket>()
    const bucket = shelves.get(def.key) ?? { def, sections: new Map() }
    const sectionKey = slot.sectionKey ?? slot.group
    const list = bucket.sections.get(sectionKey) ?? []
    list.push(slot)
    bucket.sections.set(sectionKey, list)
    shelves.set(def.key, bucket)
    byType.set(slot.category, shelves)
  }

  const shelfRank = (category: CoverageCategory, key: string) => {
    if (category === "food" || category === "drinks")
      return SHELVES[category].findIndex((s) => s.key === key)
    if (category === "facilities")
      return amenityRank.get(key.slice(AMENITY_SHELF.length)) ?? 1e6
    return 0
  }
  const sectionSort = (a: ShelfSection, b: ShelfSection) => {
    // The place's own photo (an area) comes last, as on a place (§5a).
    if (a.name === AREA_GROUP || b.name === AREA_GROUP)
      return a.name === AREA_GROUP ? 1 : -1
    const ra = sectionRank.get(a.key) ?? 1e6
    const rb = sectionRank.get(b.key) ?? 1e6
    return ra - rb || a.name.localeCompare(b.name, "en-GB")
  }

  const types: AlbumType[] = COVERAGE_CATEGORIES.flatMap(
    ({ key: category, label }) => {
      const shelves = byType.get(category)
      if (!shelves) return []
      const built: Shelf[] = [...shelves.values()]
        .map(({ def, sections }) => {
          const list: ShelfSection[] = [...sections.entries()]
            .map(([key, s]) => ({
              key,
              name: s[0]!.group,
              slots: [...s].sort(sortSlots),
              ...tally(s),
            }))
            .sort(sectionSort)
          const slots = list.flatMap((s) => s.slots)
          return {
            key: def.key,
            label: def.label,
            sections: list,
            covers: coversOf(slots),
            ...tally(slots),
          }
        })
        .sort(
          (a, b) =>
            shelfRank(category, a.key) - shelfRank(category, b.key) ||
            a.label.localeCompare(b.label, "en-GB")
        )
      const all = built.flatMap((s) => s.sections.flatMap((x) => x.slots))
      return [
        {
          category,
          label,
          shelves: built,
          covers: coversOf(all),
          ...tally(all),
        },
      ]
    }
  )
  return { types, ...tally(slots) }
}

/** The filter a type opens on (§5d step 2): Needed while any slot is empty. */
export const defaultShow = (t: Tally) =>
  t.empty > 0 ? ("needed" as const) : ("all" as const)

// ---- parts (§5d): Menu, Amenities, Spaces --------------------------------------

export type AlbumPartKey = "menu" | "amenities" | "spaces"

/** Album's three parts, in landing order, and the types each holds. */
export const ALBUM_PARTS: ReadonlyArray<{
  key: AlbumPartKey
  label: string
  categories: readonly CoverageCategory[]
}> = [
  { key: "menu", label: "Menu", categories: ["food", "drinks"] },
  { key: "amenities", label: "Amenities", categories: ["facilities", "other"] },
  { key: "spaces", label: "Spaces", categories: ["spaces"] },
]

export const isAlbumPartKey = (v: unknown): v is AlbumPartKey =>
  ALBUM_PARTS.some((p) => p.key === v)

export type AlbumPart = Tally & {
  key: AlbumPartKey
  label: string
  /** The part's types: Food and Drinks for Menu, one or two otherwise. */
  types: AlbumType[]
  /** Every shelf of the part, types in order: what a part without a switch lists. */
  shelves: Shelf[]
  covers: string[]
}

/** The album's parts with slots under the lens (§5d landing step 4). */
export function albumParts(view: ShelfView): AlbumPart[] {
  return ALBUM_PARTS.flatMap((part) => {
    const types = view.types.filter((t) => part.categories.includes(t.category))
    if (types.length === 0) return []
    const sum = (k: keyof Tally) => types.reduce((n, t) => n + t[k], 0)
    return [
      {
        key: part.key,
        label: part.label,
        types,
        shelves: types.flatMap((t) => t.shelves),
        covers: types.flatMap((t) => t.covers).slice(0, 4),
        total: sum("total"),
        filled: sum("filled"),
        waiting: sum("waiting"),
        empty: sum("empty"),
      },
    ]
  })
}

/** An empty part, so its screen can still be drawn under a narrow lens. */
export function emptyPart(key: AlbumPartKey): AlbumPart {
  const label = ALBUM_PARTS.find((p) => p.key === key)!.label
  return {
    key,
    label,
    types: [],
    shelves: [],
    covers: [],
    total: 0,
    filled: 0,
    waiting: 0,
    empty: 0,
  }
}

/**
 * Menu's Food | Drinks switch (§5d "A part" step 2): the type asked for when
 * the part has it, else Food, else the first type it has.
 */
export function partType(part: AlbumPart, asked: unknown): AlbumType | null {
  return (
    part.types.find((t) => t.category === asked) ??
    part.types.find((t) => t.category === "food") ??
    part.types[0] ??
    null
  )
}
