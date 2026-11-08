import type { Department } from "@/lib/config/departments"

import { TEAM_NAME } from "../community/search"

export const PEOPLE_PAGE_SIZE = 24

export const PEOPLE_COPY = {
  title: "People",
  scope: "All venues",
  summary: "Colleagues across Lapen Inns, and the photos they've shared.",
  find: "Find people",
  next: "Next people",
  clear: "Clear search",
  loading: "Loading people…",
  newStarters: "New starters appear once they've signed in.",
} as const

export const PROFILE_COPY = {
  scope: ["People", "Profile"],
  srTitle: "Profile",
  shared: "Shared photos",
  order: "Newest first",
  back: "Back to People",
  loading: "Loading profile…",
  unavailable: "This profile isn't available",
  unavailableBody:
    "The person may have left Lapen Inns, or the link is wrong. Photos they shared stay in Photos.",
  emptyBody: "Photos appear here as soon as they're ready.",
} as const

export const TEAM_TAG: Record<Department, string> = { foh: "FOH", boh: "BOH" }

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName
}

export function photoCount(count: number): string {
  return `${count} ${count === 1 ? "photo" : "photos"}`
}

/**
 * How far Next people goes. Each page re-reads everyone above it, so past
 * this a name search is the way to find someone.
 */
export const PEOPLE_MAX_SHOWN = 20 * PEOPLE_PAGE_SIZE

/** How many to show: whole pages, at least one, at most PEOPLE_MAX_SHOWN. */
export function shownCount(value: string): number {
  const asked = Number(value)
  const pages =
    Number.isInteger(asked) && asked > 0
      ? Math.ceil(asked / PEOPLE_PAGE_SIZE)
      : 1
  return Math.min(pages * PEOPLE_PAGE_SIZE, PEOPLE_MAX_SHOWN)
}

/**
 * "Showing 1 to 24, A to Z by name". The order is the directory's (whole
 * display name, never how much someone has shared), so it never reads as a
 * ranking. `capped`: more people match than Next people reaches.
 */
export function showingRange(shown: number, capped = false): string {
  return capped
    ? `Showing the first ${shown}, A to Z by name. Search by name to find anyone else.`
    : `Showing 1 to ${shown}, A to Z by name`
}

export type PeopleSearch = {
  query: string
  venueName: string | null
  department: Department | null
}

/** " in Back of house at The Railway" / " at all venues" */
function where({ venueName, department }: PeopleSearch) {
  const team = department ? ` in ${TEAM_NAME[department]}` : ""
  return `${team} at ${venueName ?? "all venues"}`
}

export function isSearching(search: PeopleSearch): boolean {
  return Boolean(search.query || search.venueName || search.department)
}

/** "Showing people named Kiran at all venues."; null with nothing to describe. */
export function searchSummary(search: PeopleSearch): string | null {
  if (!isSearching(search)) return null
  const named = search.query ? ` named ${search.query}` : ""
  return `Showing people${named}${where(search)}.`
}

/** Why the search found no one, and what to widen. */
export function noResults(search: PeopleSearch): {
  title: string
  description: string
} {
  if (!isSearching(search))
    return { title: "No one here yet.", description: PEOPLE_COPY.newStarters }
  const wider = [
    search.department ? "all teams" : null,
    search.venueName ? "all venues" : null,
  ].filter((part): part is string => part !== null)
  const tryWider = wider.length ? `try ${wider.join(", or ")}` : ""
  if (search.query) {
    const fix = tryWider
      ? `Check the spelling, or ${tryWider}.`
      : "Check the spelling."
    return {
      title: `No one called ${search.query}${where(search)}.`,
      description: `${fix} ${PEOPLE_COPY.newStarters}`,
    }
  }
  return {
    title: `No one${where(search)}.`,
    description: `${tryWider.charAt(0).toUpperCase()}${tryWider.slice(1)}. ${PEOPLE_COPY.newStarters}`,
  }
}

function joinNames(names: string[]) {
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : (names[0] ?? "")
}

/**
 * The profile shows where someone works now; each photo keeps the venue it
 * was taken at. When those differ, say so, so neither is read as the other.
 */
export function movedNotice(
  member: { displayName: string; venueName: string | null },
  photos: readonly { venueName: string | null }[]
): string | null {
  if (!member.venueName) return null
  const earlier = [
    ...new Set(
      photos
        .map((photo) => photo.venueName)
        .filter(
          (venue): venue is string =>
            Boolean(venue) && venue !== member.venueName
        )
    ),
  ]
  if (earlier.length === 0) return null
  return `${firstName(member.displayName)} moved to ${member.venueName}. Earlier photos keep ${joinNames(earlier)}, where they were taken.`
}
