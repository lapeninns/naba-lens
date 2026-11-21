import { STAFF_ALBUM_POSTS } from "@/lib/config/staff-album-posts"

import { SectionTabs, type SectionTab } from "../section-tabs"
import { managerHrefs } from "./hrefs"

/**
 * The tabs inside a manager section (redesign R4, ia.md): Review, Album and
 * Venue have siblings; Overview and Requests have none. Each tab is its own
 * route, so it can be linked, loaded and fail on its own. Rendered under the
 * page title of each tab root, never on detail pages (those take a BackLink).
 */
export type ManagerTabSection = "review" | "album" | "venue"

export type ManagerTabId = {
  review: "one" | "list" | "posted"
  album: "menu" | "spaces" | "amenities"
  venue: "details" | "team" | "progress" | "exports" | "history"
}

export const MANAGER_TAB_LABEL: Record<ManagerTabSection, string> = {
  review: "Review views",
  album: "Album views",
  venue: "Venue views",
}

export const MANAGER_TABS_COPY = {
  review: {
    one: "One at a time",
    list: "All photos",
    posted: "Posted by staff",
  },
  album: { menu: "Menu", spaces: "Spaces", amenities: "Amenities" },
  venue: {
    details: "Details",
    team: "Team",
    progress: "Progress",
    exports: "Exports",
    history: "History",
  },
} as const

/** The tabs of one section, in order. Posted by staff only while D20 is on. */
export function managerTabs(
  section: ManagerTabSection,
  { postedByStaff = STAFF_ALBUM_POSTS }: { postedByStaff?: boolean } = {}
): SectionTab[] {
  if (section === "review") {
    const C = MANAGER_TABS_COPY.review
    return [
      { id: "one", label: C.one, href: managerHrefs.review() },
      { id: "list", label: C.list, href: managerHrefs.reviewList },
      ...(postedByStaff
        ? [{ id: "posted", label: C.posted, href: managerHrefs.postedByStaff }]
        : []),
    ]
  }
  if (section === "album") {
    const C = MANAGER_TABS_COPY.album
    return [
      { id: "menu", label: C.menu, href: managerHrefs.menu() },
      { id: "spaces", label: C.spaces, href: managerHrefs.spaces },
      { id: "amenities", label: C.amenities, href: managerHrefs.amenities },
    ]
  }
  const C = MANAGER_TABS_COPY.venue
  return [
    { id: "details", label: C.details, href: managerHrefs.venue },
    { id: "team", label: C.team, href: managerHrefs.team },
    { id: "progress", label: C.progress, href: managerHrefs.metrics },
    { id: "exports", label: C.exports, href: managerHrefs.exports },
    { id: "history", label: C.history, href: managerHrefs.venueHistory },
  ]
}

export function ManagerTabs<S extends ManagerTabSection>({
  section,
  active,
  postedByStaff,
  className,
}: {
  section: S
  active: ManagerTabId[S]
  postedByStaff?: boolean
  className?: string
}) {
  return (
    <SectionTabs
      label={MANAGER_TAB_LABEL[section]}
      tabs={managerTabs(section, { postedByStaff })}
      active={active}
      className={className}
    />
  )
}
