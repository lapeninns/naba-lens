"use client"

import * as React from "react"
import Link from "next/link"
import { StarIcon } from "@phosphor-icons/react"

import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import { formatDateTime } from "@/components/nabalens/menus/copy"
import { waitingFor } from "@/components/nabalens/menu-photos/copy"
import { Card } from "@/components/nabalens/common-room"
import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import { dishName } from "@/lib/menus/dish-name"
import { cn } from "@/lib/utils"

import { ownPhotoBlocked, type ListCard } from "./card-model"
import { contributorHref, itemHref, type ReviewScope } from "./links"
import { CONTRIBUTOR_CHIP, RECHECK_LABEL, REVIEW_COPY } from "./review-copy"

export type CardError = { text: string; refresh?: boolean }

/** The state chip: the decision as it stands (or Waiting). */
export function CardStateChip({ card }: { card: ListCard }) {
  const s = REVIEW_COPY.state
  switch (card.state) {
    case null:
      return card.settled ? (
        <StatusChip tone="closed">{s.withdrawn}</StatusChip>
      ) : (
        <StatusChip tone="pending">{s.waiting}</StatusChip>
      )
    case "accepted":
      return card.isEffectivePrimary ? (
        <StatusChip tone="positive">
          <StarIcon aria-hidden />
          {s.menuPhoto}
        </StatusChip>
      ) : (
        <StatusChip state="accepted">{s.accepted}</StatusChip>
      )
    case "better_photo_requested":
      return (
        <StatusChip state="needs_another_photo">{s.askedAnother}</StatusChip>
      )
    case "needs_recheck":
      return <StatusChip state="unknown">{s.recheck}</StatusChip>
  }
}

/** "Labelled: Soup (Large)", "No label", or "Labelled for Pie, no longer on the menu". */
function labelLines(card: ListCard): string[] {
  if (card.staffLabels.length === 0) return [REVIEW_COPY.noLabel]
  return card.staffLabels.map((l) =>
    l.onMenu
      ? REVIEW_COPY.labelled(l.itemName, l.variantName, l.unspecified)
      : REVIEW_COPY.labelledOld(l.itemName)
  )
}

/**
 * One photo to review: a large thumbnail that opens the preview, who took it
 * (linked to their contributions), when, the staff label, the menu item and
 * the decision so far. A card decided out of the current view collapses with
 * its new state until the filter changes, so the list never jumps.
 */
export function ReviewCard({
  card,
  scope,
  now,
  error,
  actions,
  onOpenPreview,
  onRefresh,
  showItemLink = true,
  headingLevel = 3,
}: {
  card: ListCard
  scope: ReviewScope
  /** Render time (ISO), so waiting ages match between server and browser. */
  now: string
  error?: CardError
  actions?: React.ReactNode
  onOpenPreview: (trigger: HTMLElement) => void
  onRefresh: () => void
  showItemLink?: boolean
  /** 2 for a card on its own; 3 under its item's group heading. */
  headingLevel?: 2 | 3
}) {
  const id = React.useId()
  const titleId = `${id}-title`
  const who = card.isSelf ? REVIEW_COPY.you : card.contributor.name
  const itemName = card.item?.name ?? null
  const waited = card.state === null ? waitingFor(card.uploadedAt, now) : null
  const chip = CONTRIBUTOR_CHIP[card.contributor.status]
  const label = REVIEW_COPY.photoBy(card.contributor.name)
  const Heading = headingLevel === 2 ? "h2" : "h3"

  if (card.settled) {
    return (
      <Card
        as="article"
        variant="tint"
        tight
        data-card-key={card.key}
        aria-labelledby={titleId}
        className="flex items-center gap-3"
      >
        <EvidenceThumb
          src={card.asset.thumbnailUrl}
          className="aspect-square w-14 shrink-0 rounded-control"
        />
        <div className="grid min-w-0 gap-1">
          <p id={titleId} className="text-label break-words text-ink">
            {card.settledItemName ?? itemName ?? REVIEW_COPY.noMenuItem} ·{" "}
            {label}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <CardStateChip card={card} />
            <span className="text-meta text-ink-muted">
              {REVIEW_COPY.settled}
            </span>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card
      as="article"
      data-card-key={card.key}
      aria-labelledby={titleId}
      className="gap-4 @min-[40rem]:grid-cols-[minmax(0,320px)_minmax(0,1fr)]"
    >
      <div className="relative">
        <EvidenceThumb src={card.asset.thumbnailUrl ?? card.asset.previewUrl} />
        <button
          type="button"
          data-preview-trigger={card.key}
          onClick={(event) => onOpenPreview(event.currentTarget)}
          aria-label={REVIEW_COPY.openPreview(card.contributor.name)}
          className="absolute inset-0 z-10 min-h-11 rounded-control outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        />
      </div>
      <div className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <CardStateChip card={card} />
          {card.recheckKind ? (
            <StatusChip tone="attention">
              {RECHECK_LABEL[card.recheckKind]}
            </StatusChip>
          ) : null}
          {card.basis === "reviewer" ? (
            <StatusChip tone="neutral">
              {REVIEW_COPY.matchedByReviewer}
            </StatusChip>
          ) : null}
        </div>
        <Heading id={titleId} className="text-item-title break-words text-ink">
          {card.item ? (
            showItemLink ? (
              <Link
                href={itemHref(scope, card.item.itemId)}
                className="rounded-control underline-offset-3 outline-none hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
              >
                {dishName(card.item)}
              </Link>
            ) : (
              dishName(card.item)
            )
          ) : (
            REVIEW_COPY.noMenuItem
          )}
        </Heading>
        <dl className="grid gap-1.5 text-body">
          <div className="flex flex-wrap gap-x-2">
            <dt className="sr-only">Staff label</dt>
            {labelLines(card).map((line) => (
              <dd key={line} className="break-words text-ink">
                {line}
              </dd>
            ))}
          </div>
          {card.basis === "reviewer" && card.correctsItemName ? (
            <div className="flex flex-wrap gap-x-2">
              <dt className="sr-only">Correction</dt>
              <dd className="break-words text-ink-muted">
                {REVIEW_COPY.movedFrom(card.correctsItemName)}
              </dd>
            </div>
          ) : null}
          {card.reason ? (
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-ink-muted">{REVIEW_COPY.reason}</dt>
              <dd className="break-words text-ink">{card.reason}</dd>
            </div>
          ) : null}
        </dl>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
          {card.isSelf ? (
            <span className="font-semibold text-ink">{who}</span>
          ) : (
            <Link
              href={contributorHref(scope, card.contributor.id)}
              className="rounded-control font-bold break-words text-ink underline underline-offset-3 outline-none hover:decoration-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid max-md:inline-flex max-md:min-h-11 max-md:items-center"
            >
              {who}
            </Link>
          )}
          {chip ? <StatusChip tone="closed">{chip}</StatusChip> : null}
          <span className="text-meta text-ink-muted">
            {REVIEW_COPY.uploaded(formatDateTime(card.uploadedAt), waited)}
          </span>
        </p>
        {card.recheckKind === "variant_removed" &&
        !ownPhotoBlocked(card, scope.kind) ? (
          <p className="text-body text-ink-muted">
            {REVIEW_COPY.variantRemovedNote}
          </p>
        ) : null}
        {ownPhotoBlocked(card, scope.kind) ? (
          <Notice tone="plain">{REVIEW_COPY.ownPhoto}</Notice>
        ) : (
          actions
        )}
        {error ? (
          <div
            role="alert"
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 text-body font-semibold text-warn-fg"
            )}
          >
            <span>{error.text}</span>
            {error.refresh ? (
              <Button type="button" variant="row-link" onClick={onRefresh}>
                {REVIEW_COPY.refresh}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  )
}
