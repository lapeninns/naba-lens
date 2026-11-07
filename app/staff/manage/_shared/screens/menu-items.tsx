import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { manageHrefs } from "@/components/nabalens/coverage"
import { EmptyState } from "@/components/nabalens/empty-state"
import {
  ITEM_REVIEW_COPY,
  OUR_MENU_COPY,
  OurMenuFilters,
  itemsWithPhoto,
  waitingFor,
  type OurMenuFilter,
} from "@/components/nabalens/menu-photos"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { CountBadge } from "@/components/nabalens/status-chip"
import { buttonVariants } from "@/components/ui/button"
import {
  getOurMenu,
  listItemPhotoCandidates,
  listOurMenuItems,
} from "@/lib/server/coverage"
import type { OurMenuView } from "@/lib/server/coverage/types"
import { isUuid } from "@/lib/server/coverage/validate"

import { type ManageContext } from "../context"
import { ManageFrame } from "../frame"
import {
  ItemPhotoReviewControl,
  OurMenuListControl,
} from "../menu-items-controls"

import { failed, param, type ManageSearch } from "./common"

const SEGMENT =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-chip px-3 text-center text-meta-touch font-semibold text-ink-muted outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-0 focus-visible:outline-focus aria-[current=page]:bg-panel aria-[current=page]:text-ink aria-[current=page]:shadow-[0_0_0_1px_var(--color-line-control)] md:min-h-8 md:text-label md:whitespace-nowrap"

/** "12 of 40 menu items have an accepted photo · 3 photos to review, oldest waiting 2 days". */
function figures(menu: OurMenuView, now: string) {
  const review = menu.review
  const oldest = review ? waitingFor(review.oldestCandidateAt, now) : null
  return (
    <>
      <p>{itemsWithPhoto(menu.totals.covered, menu.totals.eligible)}.</p>
      {review ? (
        <p>
          {review.pendingCandidates === 0
            ? "No labelled photos are waiting for a decision."
            : `${review.pendingCandidates} ${review.pendingCandidates === 1 ? "photo is" : "photos are"} waiting for a decision${oldest ? `; the oldest has waited ${oldest}` : ""}.`}
        </p>
      ) : null}
      {menu.totals.needsRecheck > 0 ? (
        <p>
          {menu.totals.needsRecheck}{" "}
          {menu.totals.needsRecheck === 1 ? "dish needs" : "dishes need"} a
          photo checked again after a menu change.
        </p>
      ) : null}
    </>
  )
}

/**
 * Our menu for a reviewer (the venue's manager, or an admin for one venue):
 * labelled photos waiting for a decision grouped by dish, every dish with its
 * accepted photos, and one dish's photos (`?item=`). A separate measure from
 * monthly targets and section coverage.
 */
export async function MenuItemsScreen({
  ctx,
  search,
}: {
  ctx: ManageContext
  search: ManageSearch
}) {
  const now = new Date().toISOString()
  const base = manageHrefs(ctx.basePath).menuItems
  const requestedItem = param(search, "item")
  const itemId = requestedItem && isUuid(requestedItem) ? requestedItem : null
  const view = itemId
    ? "item"
    : param(search, "view") === "items"
      ? "items"
      : "queue"

  const summary = await getOurMenu(ctx.actor, { venueId: ctx.venueId })
  if (!summary.ok) return failed(ctx, summary)
  const menu = summary.menu
  const frame = (children: React.ReactNode, summaryNode?: React.ReactNode) => (
    <ManageFrame
      ctx={ctx}
      section="menu_items"
      title={ITEM_REVIEW_COPY.title}
      summary={summaryNode}
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <OfflineNotice />
      {children}
    </ManageFrame>
  )

  if (menu.menuState !== "ready") {
    return frame(
      <EmptyState
        title={
          menu.menuState === "no_menu"
            ? OUR_MENU_COPY.noMenu
            : OUR_MENU_COPY.emptyTitle
        }
        description={
          <p>
            {menu.menuState === "no_menu"
              ? "An admin publishes and activates each venue’s menu."
              : OUR_MENU_COPY.emptyText}
          </p>
        }
      />
    )
  }

  const pending = menu.review?.pendingCandidates ?? 0
  const tabs = (
    <nav
      aria-label="Show"
      className="grid w-full grid-cols-2 gap-0.5 rounded-control bg-well p-0.5 md:inline-flex md:w-auto md:max-w-full md:justify-self-start"
    >
      <Link
        href={base}
        aria-current={view === "queue" ? "page" : undefined}
        className={SEGMENT}
      >
        {ITEM_REVIEW_COPY.toReview}
        {pending ? <CountBadge count={pending} label="to review" /> : null}
      </Link>
      <Link
        href={`${base}?view=items`}
        aria-current={view === "items" ? "page" : undefined}
        className={SEGMENT}
      >
        {ITEM_REVIEW_COPY.allDishes}
      </Link>
    </nav>
  )
  const labelling = (
    <Notice tone="plain" role="note">
      {ITEM_REVIEW_COPY.labellingNote}
    </Notice>
  )

  if (view === "items") {
    const sectionParam = param(search, "section")
    const filter: OurMenuFilter = {
      sectionId: menu.sections.some((s) => s.sectionId === sectionParam)
        ? (sectionParam ?? null)
        : null,
      gapsOnly: param(search, "filter") === "gaps",
      query: (param(search, "q") ?? "").trim().slice(0, 80),
    }
    const items = await listOurMenuItems(ctx.actor, {
      venueId: ctx.venueId,
      ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
      gapsOnly: filter.gapsOnly,
      ...(filter.query ? { query: filter.query } : {}),
    })
    if (!items.ok) return failed(ctx, items)
    const filtered = !!filter.query || filter.gapsOnly || !!filter.sectionId
    return frame(
      <>
        {tabs}
        <OurMenuFilters
          basePath={base}
          filter={filter}
          sections={menu.sections}
          extra={{ view: "items" }}
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
                  href={`${base}?view=items`}
                  className={buttonVariants({
                    variant: "secondary",
                    size: "sm",
                  })}
                >
                  {OUR_MENU_COPY.allDishes}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <OurMenuListControl
            key={`${filter.sectionId}:${filter.gapsOnly}:${filter.query}`}
            initial={items}
            sections={menu.sections}
            canAdd={false}
            filter={filter}
            venueId={ctx.venueId}
            reviewBasePath={base}
          />
        )}
      </>,
      figures(menu, now)
    )
  }

  const candidates = await listItemPhotoCandidates(ctx.actor, {
    venueId: ctx.venueId,
    ...(itemId ? { itemId, includeReviewed: true } : {}),
  })
  if (!candidates.ok) return failed(ctx, candidates)

  if (view === "item") {
    const name = candidates.items[0]?.item.name
    return frame(
      <>
        <div>
          <Link
            href={base}
            className={buttonVariants({ variant: "quiet", size: "sm" })}
          >
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            {ITEM_REVIEW_COPY.backToQueue}
          </Link>
        </div>
        <h2 className="sr-only">{name ?? "Dish photos"}</h2>
        {labelling}
        <ItemPhotoReviewControl
          initial={candidates}
          venueId={ctx.venueId}
          venueName={ctx.venue.name}
          now={now}
          itemId={itemId ?? undefined}
          emptyTitle={ITEM_REVIEW_COPY.emptyItem}
        />
      </>,
      figures(menu, now)
    )
  }

  return frame(
    <>
      {tabs}
      {labelling}
      <ItemPhotoReviewControl
        initial={candidates}
        venueId={ctx.venueId}
        venueName={ctx.venue.name}
        now={now}
        basePath={base}
      />
    </>,
    candidates.items.length === 0 ? (
      <p>{itemsWithPhoto(menu.totals.covered, menu.totals.eligible)}.</p>
    ) : (
      <>
        <p>{ITEM_REVIEW_COPY.summary}</p>
        {figures(menu, now)}
      </>
    )
  )
}
