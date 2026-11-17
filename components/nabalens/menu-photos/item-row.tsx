"use client"

import * as React from "react"
import Link from "next/link"
import { ImageIcon, ImagesIcon, PlusIcon } from "@phosphor-icons/react"

import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import { plural } from "@/components/nabalens/coverage/copy"
import {
  useAdd,
  type AddLabelPreset,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { OurMenuItem } from "@/lib/server/coverage/types"

import { ITEM_REVIEW_COPY, OUR_MENU_COPY } from "./copy"
import { NeededByChip } from "./needed-by-chip"

/**
 * One dish or drink on Our menu: its name and variants, whether it has an
 * accepted photo (with the main photo's thumbnail), and for staff who can
 * add photos "Add photos of this dish" (the phone's photos, DESIGN.md §2).
 * Add applies the dish as a label the person can remove, and sending starts
 * at once.
 */
export function OurMenuItemRow({
  item,
  canAdd,
  reviewHref,
  primary = false,
}: {
  item: OurMenuItem
  /** The person can add photos now (active staff at an active venue). */
  canAdd: boolean
  /** Reviewers: this dish's photos to decide. */
  reviewHref?: string
  /** Home's one main action is this dish's Add photos (goals decision 12). */
  primary?: boolean
}) {
  const openAdd = useAdd()
  const id = React.useId()
  const nameId = `${id}-name`
  const variants = item.variants.map((v) => v.name).join(", ")
  const waiting = item.review?.candidates ?? 0
  const mine = item.myWaiting ?? 0

  return (
    <article
      aria-labelledby={nameId}
      className="grid min-h-16 grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-3 @regular:grid-cols-[3.5rem_minmax(0,1fr)_auto] @regular:items-center"
    >
      {item.primary ? (
        <EvidenceThumb
          src={item.primary.asset.thumbnailUrl}
          className="aspect-square w-14 rounded-control"
        />
      ) : (
        <span
          aria-hidden
          className="grid aspect-square w-14 place-items-center rounded-control border-2 border-dashed border-edge-strong text-ink-muted"
        >
          <PlusIcon className="size-6" />
        </span>
      )}
      <div className="grid min-w-0 content-start gap-1">
        <h3
          id={nameId}
          className="text-item-title [overflow-wrap:anywhere] text-ink"
        >
          {item.name}
        </h3>
        {variants ? (
          <p className="text-meta [overflow-wrap:anywhere] text-ink-muted">
            {variants}
          </p>
        ) : null}
        <p className="flex flex-wrap items-center gap-1.5">
          {item.covered ? (
            // An ok outline square with a photo icon: never the filled tick
            // square, which is Accepted's alone (common-room.md §3).
            <StatusChip tone="positive">
              <ImageIcon aria-hidden className="size-4" />
              {OUR_MENU_COPY.hasPhoto}
            </StatusChip>
          ) : (
            <StatusChip tone="neutral">{OUR_MENU_COPY.gaps}</StatusChip>
          )}
          {item.neededBy ? <NeededByChip neededBy={item.neededBy} /> : null}
          {item.needsRecheck || item.reviewState === "being_checked" ? (
            <StatusChip tone="pending">{OUR_MENU_COPY.recheck}</StatusChip>
          ) : item.reviewState === "waiting" ? (
            <StatusChip state="waiting_for_review" />
          ) : null}
          {item.acceptedCount > 1 ? (
            <span className="text-meta text-ink-muted">
              {plural(item.acceptedCount, "accepted photo")}
            </span>
          ) : null}
          {item.review && waiting > 0 ? (
            <span className="text-meta text-ink-muted">
              {plural(waiting, "photo")} to review
            </span>
          ) : null}
          {mine > 0 ? (
            <span className="text-meta text-ink-muted">
              {OUR_MENU_COPY.myWaiting(mine)}
            </span>
          ) : null}
        </p>
      </div>
      {(canAdd && openAdd) || reviewHref ? (
        <div className="col-span-2 flex flex-wrap gap-2 @max-regular:*:flex-auto @regular:col-span-1">
          {reviewHref ? (
            <Link
              href={reviewHref}
              aria-describedby={nameId}
              className={buttonVariants({
                variant: waiting > 0 ? "primary" : "secondary",
                size: "sm",
              })}
            >
              {ITEM_REVIEW_COPY.allPhotosOfDish}
            </Link>
          ) : null}
          {canAdd && openAdd ? (
            <DishAddButtons
              openAdd={openAdd}
              item={item}
              describedBy={nameId}
              primary={primary}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

/**
 * "Add photos of this dish": the phone's photos (gallery first, DESIGN.md §2;
 * no in-app camera, §9), with the dish as Add's label preset, after the
 * guidance step.
 */
export function DishAddButtons({
  openAdd,
  item,
  describedBy,
  primary = false,
}: {
  openAdd: (opts?: OpenAddOptions) => void
  item: { itemId: string; name: string }
  /** The row's name. */
  describedBy: string
  /** Blue only when this dish is the screen's one main action. */
  primary?: boolean
}) {
  return (
    <>
      {/* The row's lead action, grey: a list of dishes must not
          turn every row blue (one blue action per screen). */}
      <Button
        variant={primary ? "primary" : "secondary"}
        size="sm"
        aria-describedby={describedBy}
        // openAdd clicks the library input inside this click handler.
        onClick={() =>
          openAdd({
            source: "library",
            imagesOnly: true,
            preset: dishPreset(item),
          })
        }
      >
        <ImagesIcon data-icon="inline-start" aria-hidden />
        {OUR_MENU_COPY.addPhotos}
      </Button>
    </>
  )
}

/** The dish as Add's label preset: the dish itself, no variant chosen. */
function dishPreset(item: { itemId: string; name: string }): AddLabelPreset {
  return {
    itemId: item.itemId,
    variantId: null,
    itemName: item.name,
    variantName: null,
  }
}

/** Shared list class: one bordered panel, rows split by lines. */
export const OUR_MENU_LIST_CLASS = cn(
  "@container divide-y divide-line px-3 sm:px-4"
)
