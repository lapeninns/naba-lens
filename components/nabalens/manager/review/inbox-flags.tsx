import Link from "next/link"

import { StatusChip } from "@/components/nabalens/status-chip"
import { buttonVariants } from "@/components/ui/button"
import { belowPublicQuality } from "@/lib/config/media"
import type { QueueCard } from "@/lib/server/menu-photos/types"

import { INBOX_COPY, takenWords } from "./inbox-copy"

/**
 * What a reviewer checks first on a Review card (spec §7 M2, §12.1, FA-4,
 * FA-35): Needs label, Possible duplicate and Small (below the public-quality
 * target, reference use only) as chips; the capture date or "unknown" and the
 * staff note as lines. Nothing when the card carries no provenance.
 */
export function CardFlags({ card }: { card: QueueCard }) {
  const p = card.provenance
  const small = belowPublicQuality(card.asset.width, card.asset.height)
  const needsLabel = card.kind === "unlabelled"
  return (
    <>
      {needsLabel || p?.possibleDuplicate || small ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {needsLabel ? (
            <StatusChip tone="attention">
              {INBOX_COPY.needsLabel}
            </StatusChip>
          ) : null}
          {p?.possibleDuplicate ? (
            <StatusChip tone="attention">
              {INBOX_COPY.possibleDuplicate}
            </StatusChip>
          ) : null}
          {small ? (
            <StatusChip tone="neutral">
              <span title={INBOX_COPY.belowPublicHelp}>
                {INBOX_COPY.belowPublic}
              </span>
            </StatusChip>
          ) : null}
        </div>
      ) : null}
      {p ? (
        <p className="text-meta break-words text-ink-muted">
          {takenWords(p.capturedAt, p.capturedAtSource)}
        </p>
      ) : null}
      {p?.note ? (
        <p className="text-body break-words text-ink">
          <span className="text-ink-muted">{INBOX_COPY.note}: </span>
          {p.note}
        </p>
      ) : null}
    </>
  )
}

/** The link to a photo's review detail (manager workspace only). */
export function DetailsLink({ href, who }: { href: string; who: string }) {
  return (
    <Link
      href={href}
      aria-label={INBOX_COPY.detailsFor(who)}
      data-review-details
      className={buttonVariants({
        variant: "row-link",
        className: "justify-self-start",
      })}
    >
      {INBOX_COPY.details}
    </Link>
  )
}
