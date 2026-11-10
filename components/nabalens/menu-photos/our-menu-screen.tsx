"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { EmptyState } from "@/components/nabalens/empty-state"
import { PhotoTips } from "@/components/nabalens/guide/photo-tips"
import { GUIDE_PATH } from "@/components/nabalens/guide/task-photo-guide"
import { PageHeader } from "@/components/nabalens/page-header"
import { Card } from "@/components/nabalens/common-room/card"
import { ProgressSegments } from "@/components/nabalens/common-room/progress-segments"
import { Button, buttonVariants } from "@/components/ui/button"

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
 * "Take a photo of this dish" (and "Choose from photos") to people who can
 * upload; tapping it is the explicit choice to contribute there.
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
  const header = () => (
    <PageHeader
      venueScope={!!venueName}
      scope={venueName ?? OUR_MENU_COPY.title}
      title={OUR_MENU_COPY.title}
      className="pb-1 md:pb-1"
    />
  )

  if (load.state === "unavailable") {
    return (
      <div className="flex flex-col gap-(--gutter)">
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
      <div className="flex flex-col gap-(--gutter)">
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
      <div className="flex flex-col gap-(--gutter)">
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
    <div className="flex flex-col gap-(--gutter)">
      {header()}
      {/* The count as a card: the words, one segment per dish (a bar past
          12), then how a dish counts. Green means accepted, never blue. */}
      <Card>
        <ProgressSegments
          accepted={covered}
          target={eligible}
          label={`${progress}.`}
          className="[&>p:first-child]:font-display [&>p:first-child]:text-section-title"
        />
        {/* The segments are drawn aria-hidden; keep the named progressbar. */}
        <div
          role="progressbar"
          aria-label={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            eligible > 0 ? Math.round((covered / eligible) * 100) : 0
          }
          className="sr-only"
        />
        <p className="text-body text-ink-muted">{OUR_MENU_COPY.howItCounts}</p>
        {canAdd ? <PhotoTips guideHref={GUIDE_PATH} /> : null}
      </Card>
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
