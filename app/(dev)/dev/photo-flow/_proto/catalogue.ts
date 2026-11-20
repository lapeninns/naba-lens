import { DRINK_SECTIONS, MENU_SECTIONS } from "./old-crown-menu"

/*
 * What a photo can be labelled as, for the one venue the prototype works in.
 * Dishes and drinks come from the published Old Crown menu; spaces are the
 * areas its own website shows. Every label is a folder in Album:
 * Album → Menu | Drinks | Spaces → group → folder.
 */

export const VENUE = "The Old Crown, Girton"

export type Shelf = "menu" | "drinks" | "spaces"
export type LabelKind = "dish" | "drink" | "space"

export type Folder = {
  /** Stable id, also the URL: `menu/starters/momo-veg-chicken`. */
  id: string
  shelf: Shelf
  kind: LabelKind
  groupId: string
  groupName: string
  slug: string
  /** The name as the menu prints it. */
  name: string
  /** Lower-case text the search matches against. */
  haystack: string
}

export type Group = {
  id: string
  name: string
  shelf: Shelf
  folders: Folder[]
}

export const SHELVES: Record<
  Shelf,
  { name: string; kind: LabelKind; one: string; many: string }
> = {
  menu: { name: "Menu", kind: "dish", one: "dish", many: "dishes" },
  drinks: { name: "Drinks", kind: "drink", one: "drink", many: "drinks" },
  spaces: { name: "Spaces", kind: "space", one: "space", many: "spaces" },
}

const SPACE_SECTIONS = [
  {
    id: "inside",
    name: "Inside",
    items: ["Bar", "Bar lounge", "Restaurant", "Sports TV area"],
  },
  {
    id: "outside",
    name: "Outside",
    items: [
      "Beer garden",
      "Patio terrace",
      "Children's play area",
      "Front of the pub",
      "Car park",
    ],
  },
]

function slugOf(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function plain(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function build(
  shelf: Shelf,
  sections: { id: string; name: string; items: string[] }[]
): Group[] {
  return sections.map((section) => {
    const seen = new Set<string>()
    const folders: Folder[] = []
    for (const name of section.items) {
      const slug = slugOf(name)
      if (seen.has(slug)) continue
      seen.add(slug)
      folders.push({
        id: `${shelf}/${section.id}/${slug}`,
        shelf,
        kind: SHELVES[shelf].kind,
        groupId: section.id,
        groupName: section.name,
        slug,
        name,
        haystack: `${plain(name)} ${plain(section.name)}`,
      })
    }
    return { id: section.id, name: section.name, shelf, folders }
  })
}

export const GROUPS: Record<Shelf, Group[]> = {
  menu: build("menu", MENU_SECTIONS),
  drinks: build("drinks", DRINK_SECTIONS),
  spaces: build("spaces", SPACE_SECTIONS),
}

export const ALL_FOLDERS: Folder[] = (["menu", "drinks", "spaces"] as const)
  .flatMap((shelf) => GROUPS[shelf])
  .flatMap((group) => group.folders)

const BY_ID = new Map(ALL_FOLDERS.map((folder) => [folder.id, folder]))

export function folderById(id: string | null | undefined): Folder | null {
  return (id && BY_ID.get(id)) || null
}

export function groupOf(shelf: Shelf, groupId: string): Group | null {
  return GROUPS[shelf].find((group) => group.id === groupId) ?? null
}

/** The breadcrumb words: Album → Menu → Starters → Momo (Veg/Chicken). */
export function folderTrail(folder: Folder): string[] {
  return ["Album", SHELVES[folder.shelf].name, folder.groupName, folder.name]
}

export function folderHref(base: string, folder: Folder): string {
  return `${base}/album/${folder.id}`
}

/**
 * Search the venue's dishes, drinks and spaces. Every word typed must be in
 * the name or its section; names that start with the text come first. An
 * empty search returns nothing: the caller shows its own starting list.
 */
export function searchFolders(query: string, limit = 30): Folder[] {
  const words = plain(query).split(" ").filter(Boolean)
  if (words.length === 0) return []
  const first = words.join(" ")
  const scored: { folder: Folder; score: number }[] = []
  for (const folder of ALL_FOLDERS) {
    if (!words.every((word) => folder.haystack.includes(word))) continue
    const name = plain(folder.name)
    const score = name.startsWith(first)
      ? 0
      : name.split(" ").some((part) => part.startsWith(words[0]))
        ? 1
        : name.includes(first)
          ? 2
          : 3
    scored.push({ folder, score })
  }
  scored.sort(
    (a, b) => a.score - b.score || a.folder.name.localeCompare(b.folder.name)
  )
  return scored.slice(0, limit).map((entry) => entry.folder)
}
