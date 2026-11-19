import Link from "next/link"
import { FilmStripIcon, ImageIcon } from "@phosphor-icons/react/dist/ssr"

import { StatusChip } from "@/components/nabalens/status-chip"
import { Photo } from "@/components/ui/photo"
import { STAFF_PHOTO_ROUTES } from "@/lib/config/album-upload-tray"
import { HOME_COPY } from "@/lib/staff/home"
import {
  datesLine,
  OUTCOME_CHIP,
  receiptWord,
  type MyUpload,
} from "@/lib/staff/my-uploads"

/** How many of the newest photos Home lists (DESIGN.md §5c step 7). */
export const RECENT_COUNT = 6

/**
 * Recent activity on Home (DESIGN.md §5c step 7): the person's newest photos
 * at this venue with what happened to each, and a way to all of them on Me.
 * `items` is null when the read failed.
 */
export function RecentActivity({ items }: { items: MyUpload[] | null }) {
  return (
    <section className="grid gap-2" aria-labelledby="home-recent-title">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h2 id="home-recent-title" className="type-section-title">
          {HOME_COPY.recentTitle}
        </h2>
        <Link
          href={STAFF_PHOTO_ROUTES.photos}
          className="inline-flex min-h-11 items-center rounded-control text-label text-accent-text underline underline-offset-4 focus-ring"
        >
          {HOME_COPY.seeYourPhotos}
        </Link>
      </div>
      {items === null ? (
        <p className="rounded-card border border-line bg-surface p-4 text-body text-ink-muted">
          {HOME_COPY.recentFailed}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-surface p-4 text-body text-ink-muted">
          {HOME_COPY.recentEmpty}
        </p>
      ) : (
        <ul className="grid gap-2">
          {items.slice(0, RECENT_COUNT).map((item) => {
            const word = receiptWord(item)
            const slot =
              item.slots.find(({ outcome }) => outcome === "awaiting_review") ??
              item.slots[0]
            const name =
              item.slots.map(({ name }) => name).join(", ") ||
              (item.labelHelp
                ? "With your manager"
                : item.sharedKinds.length
                  ? "Shared photo"
                  : item.mediaType === "video"
                    ? "Video"
                    : "Photo without a slot")
            const Icon = item.mediaType === "video" ? FilmStripIcon : ImageIcon
            return (
              <li
                key={item.assetId}
                className="flex min-h-16 items-center gap-3 rounded-card border border-line bg-surface p-2.5"
              >
                {item.mediaType === "image" && item.uploadState === "ready" ? (
                  <Photo
                    alt=""
                    ratio="1/1"
                    src={`/api/media/${item.assetId}/thumb`}
                    className="size-12 shrink-0"
                  />
                ) : (
                  <span className="grid size-12 shrink-0 place-items-center rounded-control bg-surface-2">
                    <Icon aria-hidden className="size-5" />
                  </span>
                )}
                <div className="grid min-w-0 gap-0.5">
                  <p className="text-label [overflow-wrap:anywhere]">{name}</p>
                  <p className="text-meta text-ink-muted">{datesLine(item)}</p>
                  {word ? (
                    <span className="text-meta font-semibold">{word}</span>
                  ) : slot ? (
                    <StatusChip
                      state={OUTCOME_CHIP[slot.outcome]}
                      className="justify-self-start"
                    />
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
