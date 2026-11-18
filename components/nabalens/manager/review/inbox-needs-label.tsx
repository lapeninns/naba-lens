import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import type { QueueCard } from "@/lib/server/menu-photos/types"

import { managerHrefs } from "../hrefs"
import { INBOX_COPY } from "./inbox-copy"
import { CardFlags, DetailsLink } from "./inbox-flags"

/**
 * Needs label on Review in a thumb (FA-4, S3-R1 K1 and E4): the thumb stage
 * decides dish and place photos, so the photos that still need a slot (I'm
 * not sure, food or drink with no dish, no slot for 7 days) are listed under
 * it, each opening its review detail, where the manager labels it. The same
 * flags as a list card (inbox-flags.tsx); nothing when none wait. Shown
 * whatever the menu state (S3-R8 W2): Overview counts these photos at a
 * venue with no ready menu too, and Not used and the place and facility
 * routes on the detail need no menu.
 */
export function NeedsLabelList({
  cards,
  note,
}: {
  cards: readonly QueueCard[]
  /** A line under the heading (the menu is not ready yet, S3-R8 W2). */
  note?: string
}) {
  const waiting = cards.filter((c) => c.kind === "unlabelled")
  if (waiting.length === 0) return null
  return (
    <section
      aria-labelledby="review-needs-label"
      className="grid max-w-reading gap-3"
      data-review-needs-label
    >
      <h2 id="review-needs-label" className="text-heading-sm text-ink">
        {INBOX_COPY.needsLabelTitle(waiting.length)}
      </h2>
      {note ? <p className="text-body text-ink-muted">{note}</p> : null}
      <ul className="grid gap-3">
        {waiting.map((card) => {
          const who = card.isSelf ? INBOX_COPY.you : card.contributor.name
          return (
            <li
              key={card.key}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-card border border-line bg-surface p-3"
            >
              <EvidenceThumb
                src={card.asset.thumbnailUrl ?? card.asset.previewUrl}
                className="w-24 sm:w-32"
              />
              <div className="grid min-w-0 content-start gap-1.5">
                <p className="text-label break-words text-ink">{who}</p>
                <CardFlags card={card} />
                <DetailsLink
                  href={managerHrefs.photo(card.asset.assetId)}
                  who={who}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
