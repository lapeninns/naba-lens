"use client"

import * as React from "react"
import Link from "next/link"
import {
  CameraIcon,
  CameraPlusIcon,
  ImageIcon,
  ImagesIcon,
} from "@phosphor-icons/react"

import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import { plural } from "@/components/nabalens/coverage/copy"
import {
  useAdd,
  type AddLabelPreset,
} from "@/components/nabalens/shell/add-context"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { OurMenuItem } from "@/lib/server/coverage/types"

import { ITEM_REVIEW_COPY, OUR_MENU_COPY } from "./copy"

/**
 * One dish or drink on Our menu: its name and variants, whether it has an
 * accepted photo (with the main photo's thumbnail), and for staff who can
 * upload "Take a photo of this dish" (the camera, primary) and "Choose from
 * photos" (the library). Either way Add applies the dish as a label the
 * person can remove, and the upload starts at once: Take a photo, then Done.
 */
export function OurMenuItemRow({
  item,
  canAdd,
  reviewHref,
}: {
  item: OurMenuItem
  /** The person can upload now (active staff at an active venue). */
  canAdd: boolean
  /** Reviewers: this dish's photos to decide. */
  reviewHref?: string
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
      className="grid min-h-16 grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-3 @min-[36rem]:grid-cols-[3.5rem_minmax(0,1fr)_auto] @min-[36rem]:items-center"
    >
      {item.primary ? (
        <EvidenceThumb
          src={item.primary.asset.thumbnailUrl}
          className="aspect-square w-14 rounded-control"
        />
      ) : (
        <span
          aria-hidden
          className="grid aspect-square w-14 place-items-center rounded-control border-2 border-dashed border-border-strong text-ink-muted"
        >
          <CameraIcon className="size-6" />
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
            // square, which is Accepted's alone (DESIGN.md §3).
            <StatusChip tone="positive">
              <ImageIcon aria-hidden className="size-4" />
              {OUR_MENU_COPY.hasPhoto}
            </StatusChip>
          ) : (
            <StatusChip tone="neutral">{OUR_MENU_COPY.gaps}</StatusChip>
          )}
          {item.needsRecheck ? (
            <StatusChip tone="pending">{OUR_MENU_COPY.recheck}</StatusChip>
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
        <div className="col-span-2 flex flex-wrap gap-2 @max-[36rem]:*:flex-auto @min-[36rem]:col-span-1">
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
            <>
              {/* The row's lead action, grey: a list of dishes must not
                  turn every row blue (one blue action per screen). */}
              <Button
                variant="secondary"
                size="sm"
                aria-describedby={nameId}
                // openAdd clicks the camera input inside this click handler.
                onClick={() =>
                  openAdd({
                    source: "camera",
                    imagesOnly: true,
                    preset: dishPreset(item),
                  })
                }
              >
                <CameraPlusIcon data-icon="inline-start" aria-hidden />
                {OUR_MENU_COPY.takePhoto}
              </Button>
              <Button
                variant="quiet"
                size="sm"
                aria-describedby={nameId}
                onClick={() =>
                  openAdd({
                    source: "library",
                    imagesOnly: true,
                    preset: dishPreset(item),
                  })
                }
              >
                <ImagesIcon data-icon="inline-start" aria-hidden />
                {OUR_MENU_COPY.choosePhoto}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

/** The dish as Add's label preset: the dish itself, no variant chosen. */
function dishPreset(item: OurMenuItem): AddLabelPreset {
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
