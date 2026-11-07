import { SectionTabs } from "../section-tabs"

export type ManageSection =
  "overview" | "review" | "checklist" | "menu" | "menu_items" | "team"

const SECTIONS: { id: ManageSection; label: string; path: string }[] = [
  { id: "overview", label: "Overview", path: "" },
  { id: "review", label: "Review", path: "/review" },
  { id: "checklist", label: "Checklist", path: "/checklist" },
  { id: "menu", label: "Menu", path: "/menu" },
  // Our menu: menu items with an accepted photo, a separate measure.
  { id: "menu_items", label: "Our menu", path: "/menu/items" },
  { id: "team", label: "Team", path: "/team" },
]

/** Hrefs of one venue's manager tools (`/staff/manage` or an admin venue). */
export function manageHrefs(basePath: string) {
  return {
    overview: basePath,
    review: `${basePath}/review`,
    checklist: `${basePath}/checklist`,
    requirement: (id: string) =>
      `${basePath}/checklist/${encodeURIComponent(id)}`,
    menu: `${basePath}/menu`,
    menuItems: `${basePath}/menu/items`,
    team: `${basePath}/team`,
    staff: (id: string) => `${basePath}/team?staff=${encodeURIComponent(id)}`,
  }
}

export type ManageHrefs = ReturnType<typeof manageHrefs>

/**
 * The same six views, order and words for a manager and an admin. `label`
 * names the scope: "Manage The Railway" or "Coverage for The Railway".
 */
export function ManageNav({
  basePath,
  active,
  pendingReview,
  label = "Venue tools",
}: {
  basePath: string
  active: ManageSection
  pendingReview?: number
  label?: string
}) {
  return (
    <SectionTabs
      label={label}
      active={active}
      tabs={SECTIONS.map((section) => ({
        id: section.id,
        label: section.label,
        href: `${basePath}${section.path}`,
        count:
          section.id === "review" && pendingReview
            ? { value: pendingReview, label: "to review" }
            : undefined,
      }))}
    />
  )
}
