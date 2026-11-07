"use client"

import * as React from "react"
import Link from "next/link"
import { CameraPlusIcon, CheckCircleIcon } from "@phosphor-icons/react"

import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import { plural } from "@/components/nabalens/coverage/copy"
import { useAdd } from "@/components/nabalens/shell/add-context"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { OurMenuItem } from "@/lib/server/coverage/types"

import { ITEM_REVIEW_COPY, OUR_MENU_COPY } from "./copy"

/**
 * One dish or drink on Our menu: its name and variants, whether it has an
 * accepted photo (with the main photo's thumbnail), and for staff who can
 * upload an explicit "Add a photo of this dish", which opens the photo
 * library with the dish suggested as the label. The suggestion is only a
 * draft in the label editor; nothing is labelled until the person saves.
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

  return (
    <article
      aria-labelledby={nameId}
      className="grid grid-cols-[4rem_minmax(0,1fr)] gap-3 py-3 @min-[36rem]:grid-cols-[4rem_minmax(0,1fr)_auto] @min-[36rem]:items-center"
    >
      {item.primary ? (
        <EvidenceThumb
          src={item.primary.asset.thumbnailUrl}
          className="aspect-square w-16"
        />
      ) : (
        <span
          aria-hidden
          className="grid aspect-square w-16 place-items-center rounded-print border border-dashed border-line-control text-ink-subtle"
        >
          <CameraPlusIcon className="size-6" />
        </span>
      )}
      <div className="grid min-w-0 content-start gap-1">
        <h3
          id={nameId}
          className="text-item-title-touch break-words text-ink md:text-item-title"
        >
          {item.name}
        </h3>
        {variants ? (
          <p className="text-meta-touch break-words text-ink-muted md:text-meta">
            {variants}
          </p>
        ) : null}
        <p className="flex flex-wrap items-center gap-1.5">
          {item.covered ? (
            <StatusChip tone="positive">
              <CheckCircleIcon aria-hidden className="size-3.5" />
              {OUR_MENU_COPY.hasPhoto}
            </StatusChip>
          ) : (
            <StatusChip tone="neutral">{OUR_MENU_COPY.gaps}</StatusChip>
          )}
          {item.needsRecheck ? (
            <StatusChip tone="pending">{OUR_MENU_COPY.recheck}</StatusChip>
          ) : null}
          {item.acceptedCount > 1 ? (
            <span className="text-meta-touch text-ink-muted md:text-meta">
              {plural(item.acceptedCount, "accepted photo")}
            </span>
          ) : null}
          {item.review && waiting > 0 ? (
            <span className="text-meta-touch text-ink-muted md:text-meta">
              {plural(waiting, "photo")} to review
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
            <Button
              variant="secondary"
              size="sm"
              aria-describedby={nameId}
              // openAdd clicks the library input inside this click handler.
              onClick={() =>
                openAdd({
                  source: "library",
                  imagesOnly: true,
                  preset: {
                    itemId: item.itemId,
                    variantId: null,
                    itemName: item.name,
                    variantName: null,
                  },
                })
              }
            >
              <CameraPlusIcon data-icon="inline-start" aria-hidden />
              {OUR_MENU_COPY.addPhoto}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

/** Shared list class: one bordered panel, rows split by lines. */
export const OUR_MENU_LIST_CLASS = cn(
  "@container divide-y divide-line rounded-panel border border-line bg-panel px-3 sm:px-4"
)
