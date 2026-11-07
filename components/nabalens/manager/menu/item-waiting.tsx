import Link from "next/link"

import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import { formatDate } from "@/components/nabalens/format"
import { buttonVariants } from "@/components/ui/button"

import type {
  ManagerMenuItem,
  Page,
  QueueCard,
} from "@/lib/server/menu-photos/types"

import { MANAGER_COPY } from "../copy"
import { managerHrefs } from "../hrefs"

/**
 * The item's photos waiting for the caller's decision: thumbnails with who
 * took them and when, and a link to decide them in Review (filtered to the
 * item). Own photos say another reviewer decides on them.
 */
export function ItemWaiting({
  item,
  waiting,
}: {
  item: ManagerMenuItem
  waiting: Page<QueueCard>
}) {
  const copy = MANAGER_COPY.item
  const cards = waiting.items
  return (
    <div className="grid gap-3">
      {cards.length === 0 ? (
        <p className="text-body text-ink-muted">
          {item.othersWaiting > 0 ? copy.othersWaiting : copy.noneWaiting}
        </p>
      ) : (
        <>
          <p className="text-body text-ink">
            {copy.waitingCount(
              waiting.nextCursor
                ? Math.max(item.candidateCount, cards.length)
                : cards.length
            )}
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {cards.map((card) => (
              <li
                key={card.key}
                className="grid min-w-0 content-start gap-1 rounded-card bg-surface p-2 shadow-card"
              >
                <EvidenceThumb src={card.asset.thumbnailUrl} />
                <p className="text-meta break-words text-ink">
                  {copy.photoBy(card.contributor.name)}
                </p>
                <p className="text-meta text-ink-muted">
                  {formatDate(card.uploadedAt)}
                </p>
                {card.isSelf ? (
                  <p className="text-meta text-ink-muted">{copy.ownPhoto}</p>
                ) : null}
              </li>
            ))}
          </ul>
          <Link
            href={managerHrefs.review({ item: item.itemId })}
            className={buttonVariants({
              variant: "primary",
              size: "touch",
              className: "justify-self-start max-md:w-full",
            })}
          >
            {copy.reviewWaiting}
          </Link>
        </>
      )}
      {item.ownWaiting > 0 ? (
        <p className="text-body text-ink-muted">
          {MANAGER_COPY.menu.ownWaiting}
        </p>
      ) : null}
    </div>
  )
}
