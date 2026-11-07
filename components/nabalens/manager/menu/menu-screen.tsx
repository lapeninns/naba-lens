import Link from "next/link"

import { EmptyState } from "@/components/nabalens/empty-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"

import type {
  ManagerMenuItem,
  ManagerOverview,
  Page,
} from "@/lib/server/menu-photos/types"

import { MANAGER_COPY } from "../copy"
import { managerHrefs } from "../hrefs"
import { ActivationBanner, menuMeta } from "../overview/activation-banner"
import { WorkspacePending } from "../workspace-pending"
import { MenuFilters } from "./menu-filters"
import { MenuList, type LoadMenuItems } from "./menu-list"
import type { MenuFilter } from "./menu-query"

/**
 * Menu: every active-menu item with its photo state, grouped by section, with
 * search, status and section filters in the URL. Rows open the item. Without
 * an active menu (or with an empty one) it shows the Overview's state.
 */
export function MenuScreen({
  overview,
  filter,
  items,
  loadItems,
  now,
}: {
  overview: ManagerOverview
  filter: MenuFilter
  /** The first page for `filter`; null without a ready menu. */
  items: Page<ManagerMenuItem> | null
  loadItems: LoadMenuItems
  /** ISO instant of the render, so server and browser agree. */
  now: string
}) {
  const copy = MANAGER_COPY.menu
  if (overview.menuState === "no_menu") {
    return (
      <WorkspacePending
        venueName={overview.venueName}
        title={copy.title}
        noteTitle={MANAGER_COPY.overview.noMenuTitle}
        note={MANAGER_COPY.overview.noMenuBody}
      />
    )
  }
  const meta = menuMeta(overview.menu)
  const header = (
    <PageHeader
      scope={overview.venueName}
      venueScope
      title={copy.title}
      summary={meta ? <p>{meta}</p> : undefined}
      className="pb-0 md:pb-0"
    />
  )
  if (overview.menuState === "empty" || !items) {
    return (
      <div className="grid gap-6">
        {header}
        <EmptyState
          title={MANAGER_COPY.overview.emptyTitle}
          description={<p>{MANAGER_COPY.overview.emptyBody}</p>}
        />
      </div>
    )
  }

  const filtered = !!filter.status || !!filter.sectionId || !!filter.query
  const sections = filter.sectionId
    ? overview.sections.filter((s) => s.sectionId === filter.sectionId)
    : overview.sections

  return (
    <div className="grid gap-5">
      {header}
      <ActivationBanner overview={overview} now={now} />
      <MenuFilters filter={filter} overview={overview} />
      {items.items.length === 0 ? (
        <EmptyState
          variant={filtered ? "filtered" : "done"}
          title={filter.query ? copy.noMatch(filter.query) : copy.noneInView}
          description={filter.query ? <p>{copy.noMatchBody}</p> : undefined}
          action={
            filtered ? (
              <Link
                href={managerHrefs.menu()}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                {copy.showAll}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <MenuList
          key={`${filter.status}:${filter.sectionId}:${filter.query}`}
          initial={items}
          sections={sections}
          filter={filter}
          loadItems={loadItems}
        />
      )}
    </div>
  )
}
