"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { EmptyState } from "@/components/nabalens/empty-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

import type {
  CoverageResult,
  OurMenuItem,
  OurMenuItemsInput,
  OurMenuView,
  Page,
} from "@/lib/server/coverage/types"

import { OUR_MENU_COPY, itemsWithPhoto } from "./copy"
import {
  OurMenuFilters,
  ourMenuHref,
  type OurMenuFilter,
} from "./our-menu-filters"
import { OurMenuList } from "./our-menu-list"

/**
 * What the page could read. `unavailable` is the app's own state for a failed
 * load; `needs_venue` is a staff member without a venue. Otherwise the
 * venue's menu state from the service, with the first page of dishes when
 * the menu is ready.
 */
export type OurMenuLoad =
  | { state: "unavailable" }
  | { state: "needs_venue" }
  | { state: "ready"; menu: OurMenuView; items: Page<OurMenuItem> }
  | { state: "no_menu" | "empty"; menu: OurMenuView }

export type LoadOurMenuItems = (
  input: OurMenuItemsInput & { cursor: string }
) => Promise<CoverageResult<Page<OurMenuItem>>>

/**
 * Staff "Our menu": the active venue menu grouped by section, how many items
 * have an accepted photo, search and "Still needs a photo". Each dish offers
 * "Add a photo of this dish" to people who can upload; tapping it is the
 * explicit choice to contribute there.
 */
export function OurMenuScreen({
  load,
  filter,
  canAdd,
  basePath = "/staff/menu",
  loadItems,
}: {
  load: OurMenuLoad
  filter: OurMenuFilter
  canAdd: boolean
  basePath?: string
  /** The `loadOurMenuItemsAction` Server Function, for later pages. */
  loadItems?: LoadOurMenuItems
}) {
  const router = useRouter()
  const venueName = "menu" in load ? load.menu.venue.name : null
  const header = (summary?: React.ReactNode) => (
    <PageHeader
      venueScope={!!venueName}
      scope={venueName ?? OUR_MENU_COPY.title}
      title={OUR_MENU_COPY.title}
      summary={summary}
      className="pb-0 md:pb-0"
    />
  )

  if (load.state === "unavailable") {
    return (
      <div className="flex flex-col gap-4">
        {header()}
        <ErrorState
          title={OUR_MENU_COPY.unavailableTitle}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.refresh()}
            >
              <ArrowClockwiseIcon aria-hidden />
              {ERROR_COPY.tryAgain}
            </Button>
          }
        />
      </div>
    )
  }

  if (load.state === "needs_venue") {
    return (
      <div className="flex flex-col gap-4">
        {header()}
        <EmptyState
          title={OUR_MENU_COPY.needsVenue}
          description={<p>{OUR_MENU_COPY.needsVenueText}</p>}
        />
      </div>
    )
  }

  if (load.state !== "ready") {
    return (
      <div className="flex flex-col gap-4">
        {header()}
        <EmptyState
          title={
            load.state === "no_menu"
              ? OUR_MENU_COPY.noMenu
              : OUR_MENU_COPY.emptyTitle
          }
          description={
            <p>
              {load.state === "no_menu"
                ? OUR_MENU_COPY.noMenuText
                : OUR_MENU_COPY.emptyText}
            </p>
          }
        />
      </div>
    )
  }

  const { menu, items } = load
  const { covered, eligible } = menu.totals
  const progress = itemsWithPhoto(covered, eligible)
  const filtered = !!filter.query || filter.gapsOnly || !!filter.sectionId
  const sections = filter.sectionId
    ? menu.sections.filter((s) => s.sectionId === filter.sectionId)
    : menu.sections

  return (
    <div className="flex flex-col gap-4">
      {header(
        <div className="grid gap-2">
          <p>{progress}.</p>
          <Progress
            value={eligible > 0 ? (covered / eligible) * 100 : 0}
            aria-label={progress}
            className="max-w-sm"
          />
          <p className="text-body-touch md:text-body-sm">
            {OUR_MENU_COPY.howItCounts}
          </p>
        </div>
      )}
      <OurMenuFilters
        basePath={basePath}
        filter={filter}
        sections={menu.sections}
      />
      {items.items.length === 0 ? (
        <EmptyState
          variant={filter.query ? "filtered" : "done"}
          title={
            filter.query
              ? OUR_MENU_COPY.noMatches
              : filter.gapsOnly
                ? OUR_MENU_COPY.allCovered
                : OUR_MENU_COPY.emptyTitle
          }
          description={
            filter.query ? <p>{OUR_MENU_COPY.noMatchesText}</p> : undefined
          }
          action={
            filtered ? (
              <Link
                href={ourMenuHref(basePath)}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                {OUR_MENU_COPY.allDishes}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <OurMenuList
          key={`${filter.sectionId}:${filter.gapsOnly}:${filter.query}`}
          initial={items}
          sections={sections}
          canAdd={canAdd}
          onLoadMore={
            loadItems
              ? (cursor) =>
                  loadItems({
                    ...(filter.sectionId
                      ? { sectionId: filter.sectionId }
                      : {}),
                    gapsOnly: filter.gapsOnly,
                    ...(filter.query ? { query: filter.query } : {}),
                    cursor,
                  })
              : undefined
          }
        />
      )}
    </div>
  )
}
