import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import type { QueueCard } from "@/lib/server/menu-photos/types"

import { INBOX_COPY } from "./inbox-copy"
import { CardFlags, DetailsLink } from "./inbox-flags"
import { photoHref, type ReviewScope } from "./links"

/**
 * Needs label on Review in a thumb (FA-4, S3-R1 K1 and E4): the thumb stage
 * decides dish and place photos, so the photos that still need a slot (I'm
 * not sure, food or drink with no dish, no slot for 7 days) are listed under
 * it, each opening its review detail, where the manager labels it. The same
 * flags as a list card (inbox-flags.tsx); nothing when none wait. Shown
 * whatever the menu state (S3-R8 W2): Overview counts these photos at a
 * venue with no ready menu too, and Not used and the place and facility
 * routes on the detail need no menu. The cards are every waiting photo, not
 * one queue page (S3-R13 X2), and each links to the detail of the scope's
 * workspace, the admin photo route for an admin (S3-R13 X1).
 */
export function NeedsLabelList({
  cards,
  note,
  scope = { kind: "manager" },
  more = false,
}: {
  cards: readonly QueueCard[]
  /** A line under the heading (the menu is not ready yet, S3-R8 W2). */
  note?: string
  scope?: ReviewScope
  /** More photos wait than were read: say so under the list. */
  more?: boolean
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
        {more
          ? INBOX_COPY.needsLabelTitleMore(waiting.length)
          : INBOX_COPY.needsLabelTitle(waiting.length)}
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
                  href={photoHref(scope, card.asset.assetId)}
                  who={who}
                />
              </div>
            </li>
          )
        })}
      </ul>
      {more ? (
        <p className="text-meta text-ink-muted">{INBOX_COPY.needsLabelMore}</p>
      ) : null}
    </section>
  )
}
