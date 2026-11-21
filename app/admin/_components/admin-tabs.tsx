import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { PageHeader } from "@/components/nabalens/page-header"
import {
  SectionTabs,
  type SectionTab,
} from "@/components/nabalens/section-tabs"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"

/*
 * The admin route map's tabs and picks (redesign R5, ia.md "Admin"). Every
 * admin page belongs to one nav section; where a section has siblings they
 * are SectionTabs, each its own route. A tab with views of its own (Venue
 * facts, one venue's Review and Album) shows them as a pick: link pills, the
 * current one marked aria-current. No URL changes (decision 1): the tabs
 * only give the existing routes a home.
 */

type TabDef<Id extends string> = { id: Id; label: string; href: string }

/**
 * A section's tab roots share its name as their one display title (ia.md
 * "Page title"); the current tab says which view it is.
 */
export const ADMIN_SECTION_TITLES = {
  overview: "Overview",
  library: "Library",
  people: "People",
  settings: "Settings",
} as const

/** Overview is all venues at once (ia.md: "Overview › …"). */
export const OVERVIEW_TABS = [
  { id: "by-venue", label: "By venue", href: "/admin/overview" },
  { id: "albums", label: "Albums", href: "/admin/albums" },
  { id: "this-month", label: "This month", href: "/admin/coverage" },
  { id: "metrics", label: "Metrics", href: "/admin/metrics" },
] as const satisfies readonly TabDef<string>[]

export const LIBRARY_TABS = [
  { id: "photos", label: "Photos", href: "/admin" },
  {
    id: "collections",
    label: "Collections",
    href: "/admin/library/collections",
  },
  { id: "tags", label: "Tags", href: "/admin/library/tags" },
  {
    id: "removals",
    label: "Removal requests",
    href: "/admin/library/removals",
  },
] as const satisfies readonly TabDef<string>[]

/** Venue managers sits under People (decision 8). */
export const PEOPLE_TABS = [
  { id: "accounts", label: "Accounts", href: "/admin/staff" },
  {
    id: "managers",
    label: "Venue managers",
    href: "/admin/coverage/managers",
  },
] as const satisfies readonly TabDef<string>[]

/** "Knowledge" is called Venue facts (decision 7). */
export const SETTINGS_TABS = [
  { id: "rules", label: "Rules", href: "/admin/settings" },
  { id: "activity", label: "Activity", href: "/admin/activity" },
  {
    id: "venue-facts",
    label: "Venue facts",
    href: "/admin/knowledge/sources",
  },
] as const satisfies readonly TabDef<string>[]

/** Runs are Imports, Schema upgrades are Question changes (decision 7). */
export const VENUE_FACTS_PICKS = [
  { id: "sources", label: "Sources", href: "/admin/knowledge/sources" },
  { id: "imports", label: "Imports", href: "/admin/knowledge/runs" },
  {
    id: "check-dates",
    label: "Check dates",
    href: "/admin/knowledge/check-dates",
  },
  {
    id: "question-changes",
    label: "Question changes",
    href: "/admin/knowledge/upgrades",
  },
] as const satisfies readonly TabDef<string>[]

const TAB_SETS = {
  overview: { label: "Overview", tabs: OVERVIEW_TABS },
  library: { label: "Library", tabs: LIBRARY_TABS },
  people: { label: "People", tabs: PEOPLE_TABS },
  settings: { label: "Settings", tabs: SETTINGS_TABS },
} as const

type TabSets = typeof TAB_SETS
export type AdminTabSet = keyof TabSets
export type AdminTabId<S extends AdminTabSet> = TabSets[S]["tabs"][number]["id"]

/** One section's tabs, under its page title. */
export function AdminTabs<S extends AdminTabSet>({
  set,
  active,
  className,
}: {
  set: S
  active: AdminTabId<S>
  className?: string
}) {
  const { label, tabs } = TAB_SETS[set]
  return (
    <SectionTabs
      label={label}
      active={active}
      tabs={tabs.map((tab) => ({ ...tab }))}
      className={className}
    />
  )
}

/** One pick: a view inside a tab, kept in the route (not in page state). */
export type AdminPick = { id: string; label: string; href: string }

/**
 * A row of views inside one tab (Venue facts, a venue's Review or Album):
 * link pills, the current one ink with a tick and aria-current="page".
 */
export function AdminPicks({
  label,
  picks,
  active,
  className,
}: {
  label: string
  picks: readonly AdminPick[]
  active: string
  className?: string
}) {
  return (
    <PillGroup label={label} className={className}>
      {picks.map((pick) => (
        <FilterPill
          key={pick.id}
          href={pick.href}
          selected={pick.id === active}
          current="page"
        >
          {pick.label}
        </FilterPill>
      ))}
    </PillGroup>
  )
}

export type VenueFactsPick = (typeof VENUE_FACTS_PICKS)[number]["id"]

/** Settings › Venue facts: Sources · Imports · Check dates · Question changes. */
export function VenueFactsPicks({ active }: { active: VenueFactsPick }) {
  return (
    <AdminPicks label="Venue facts" picks={VENUE_FACTS_PICKS} active={active} />
  )
}

/** The one summary every Venue facts pick shows (second handoff). */
export const VENUE_FACTS_SUMMARY =
  "Where venue facts come from, and tools that import and re-date them. Used rarely, by an admin."

/**
 * The top of a Venue facts view (ia.md "Settings › Venue facts"): the
 * Settings title and tabs, then the pick. The four pages were orphans; this
 * is their way in and between.
 */
export function VenueFactsHeader({
  active,
  summary = <p>{VENUE_FACTS_SUMMARY}</p>,
}: {
  active: VenueFactsPick
  summary?: React.ReactNode
}) {
  return (
    <div className="grid min-w-0 gap-3">
      <PageHeader
        title={ADMIN_SECTION_TITLES.settings}
        summary={summary}
        className="pb-0 md:pb-0"
      >
        <AdminTabs set="settings" active="venue-facts" />
      </PageHeader>
      <VenueFactsPicks active={active} />
    </div>
  )
}

/*
 * One venue (ia.md "Venues › one venue"): everything that sat under
 * /admin/coverage/[venueId], plus the venue's setup page.
 */

export type AdminVenueTab =
  "coverage" | "review" | "album" | "checklist" | "team" | "setup"

/** Hrefs of one venue's admin pages (the routes as they are today). */
export function adminVenueHrefs(venueId: string) {
  const base = `/admin/coverage/${encodeURIComponent(venueId)}`
  return {
    coverage: base,
    menuCoverage: `${base}/menu`,
    reviewMenu: managerHrefs.adminMenuPhotos(venueId),
    reviewChecklist: `${base}/review`,
    albumMenu: `${base}/menu/items`,
    albumSpaces: `${base}/amenities/places`,
    albumAmenities: `${base}/amenities`,
    checklist: `${base}/checklist`,
    team: `${base}/team`,
    setup: `/admin/venues/${encodeURIComponent(venueId)}`,
  }
}

export const ADMIN_VENUE_TAB_LABELS: Record<AdminVenueTab, string> = {
  coverage: "Coverage",
  review: "Review",
  album: "Album",
  checklist: "Checklist",
  team: "Team",
  setup: "Setup",
}

/** Coverage · Review · Album · Checklist · Team · Setup. */
export function AdminVenueTabs({
  venueId,
  venueName,
  active,
  pendingReview,
}: {
  venueId: string
  venueName: string
  active: AdminVenueTab
  /** Photos waiting for a decision, counted on Review. */
  pendingReview?: number
}) {
  const href = adminVenueHrefs(venueId)
  const tabs: SectionTab[] = [
    { id: "coverage", label: "Coverage", href: href.coverage },
    {
      id: "review",
      label: "Review",
      href: href.reviewMenu,
      count: pendingReview
        ? { value: pendingReview, label: "to review" }
        : undefined,
    },
    { id: "album", label: "Album", href: href.albumMenu },
    { id: "checklist", label: "Checklist", href: href.checklist },
    { id: "team", label: "Team", href: href.team },
    { id: "setup", label: "Setup", href: href.setup },
  ]
  return <SectionTabs label={venueName} tabs={tabs} active={active} />
}

export type VenueReviewPick = "menu-and-spaces" | "checklist"

/**
 * One Review tab per venue (ia.md "Two review screens per venue"): Menu and
 * spaces (menu-photos) or Checklist (review). Both routes stay.
 */
export function VenueReviewPicks({
  venueId,
  active,
}: {
  venueId: string
  active: VenueReviewPick
}) {
  const href = adminVenueHrefs(venueId)
  return (
    <AdminPicks
      label="Review"
      active={active}
      picks={[
        {
          id: "menu-and-spaces",
          label: "Menu and spaces",
          href: href.reviewMenu,
        },
        { id: "checklist", label: "Checklist", href: href.reviewChecklist },
      ]}
    />
  )
}

export type VenueAlbumPick = "menu" | "spaces" | "amenities"

/** The venue's Album: Menu · Spaces · Amenities (decision 5's words). */
export function VenueAlbumPicks({
  venueId,
  active,
}: {
  venueId: string
  active: VenueAlbumPick
}) {
  const href = adminVenueHrefs(venueId)
  return (
    <AdminPicks
      label="Album"
      active={active}
      picks={[
        { id: "menu", label: "Menu", href: href.albumMenu },
        { id: "spaces", label: "Spaces", href: href.albumSpaces },
        { id: "amenities", label: "Amenities", href: href.albumAmenities },
      ]}
    />
  )
}

export type VenueCoveragePick = "month" | "menu"

/** The venue's Coverage: this month's tallies, and the Menu section. */
export function VenueCoveragePicks({
  venueId,
  active,
}: {
  venueId: string
  active: VenueCoveragePick
}) {
  const href = adminVenueHrefs(venueId)
  return (
    <AdminPicks
      label="Coverage"
      active={active}
      picks={[
        { id: "month", label: "This month", href: href.coverage },
        { id: "menu", label: "Menu", href: href.menuCoverage },
      ]}
    />
  )
}
