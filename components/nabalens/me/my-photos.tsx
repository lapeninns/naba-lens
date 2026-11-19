"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowUUpLeftIcon,
  CheckIcon,
  ClockIcon,
  ExclamationMarkIcon,
  FilmStripIcon,
  ImageIcon,
  ImagesIcon,
} from "@phosphor-icons/react"

import { NeedsAttention } from "@/app/staff/needs-attention"
import { ALBUM_ADD_OPTIONS } from "@/components/nabalens/album/album-add-trigger"
import { Notice } from "@/components/nabalens/notice"
import { useAdd } from "@/components/nabalens/shell/add-context"
import { Button } from "@/components/ui/button"
import { LinkButton } from "@/components/ui/link-button"
import { SegmentedControl } from "@/components/ui/segmented-control"
import {
  groupByDay,
  matchesShow,
  MY_PHOTOS_COPY,
  needsYou,
  photoMark,
  photoSummary,
  PHOTO_SHOWS,
  type PhotoMark,
  type PhotoShow,
} from "@/lib/staff/my-photos"
import {
  slotPageHref,
  type MyUpload,
  type MyUploadsPage,
} from "@/lib/staff/my-uploads"
import { cn } from "@/lib/utils"

/*
 * My photos (DESIGN.md §5e, D19): one Needs you inbox, a thin Sending row,
 * the All · Waiting · In the album filter and a three-up grid grouped by the
 * day each photo was sent. Tapping a photo opens its own page, where every
 * action lives. Nothing here ranks the person (§9).
 */

type Reply<T extends object> = ({ ok: true } & T) | { ok: false; error: string }

export const photoHref = (assetId: string) => `/staff/photos/${assetId}`

const thumbSrc = (assetId: string) => `/api/media/${assetId}/thumb`

/** What a photo shows as its name: its slots, else what it is. */
export function photoTitle(item: MyUpload): string {
  if (item.slots.length > 0) return item.slots.map((s) => s.name).join(", ")
  if (item.labelHelp) return "With your manager"
  if (item.sharedKinds.length > 0) return "Shared photo"
  if (item.mediaType === "video") return "Video"
  // A photo that never finished has no slot to speak of yet.
  return item.uploadState === "ready" ? "No slot yet" : "Photo"
}

export function MyPhotos({
  initial,
  show,
  canAdd,
  loadMore,
}: {
  /** The newest page, read on the server; null when it couldn't be read. */
  initial: MyUploadsPage | null
  show: PhotoShow
  canAdd: boolean
  loadMore: (cursor: {
    before: string
    beforeId: string
  }) => Promise<Reply<{ page: MyUploadsPage }>>
}) {
  const router = useRouter()
  const openAdd = useAdd()
  const [items, setItems] = React.useState(initial?.items ?? [])
  const [next, setNext] = React.useState(initial?.next ?? null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // A refresh (after an action elsewhere) brings a fresh first page.
  const [seen, setSeen] = React.useState(initial)
  if (seen !== initial) {
    setSeen(initial)
    setItems(initial?.items ?? [])
    setNext(initial?.next ?? null)
  }

  if (initial === null)
    return (
      <Notice tone="negative" role="alert">
        {MY_PHOTOS_COPY.readFailed}
      </Notice>
    )

  const summary = photoSummary(items)
  const inbox = items.flatMap((item) => {
    const need = needsYou(item)
    return need ? [{ item, need }] : []
  })
  const sending = items.filter(
    (i) => i.uploadState === "uploading" || i.uploadState === "processing"
  ).length
  const shown = items.filter((i) => matchesShow(i, show))
  const days = groupByDay(shown)

  async function more() {
    if (!next) return
    setLoading(true)
    setError(null)
    const result = await loadMore(next)
    setLoading(false)
    if (!result.ok) return setError(result.error)
    setItems((prev) => {
      const have = new Set(prev.map((i) => i.assetId))
      return [...prev, ...result.page.items.filter((i) => !have.has(i.assetId))]
    })
    setNext(result.page.next)
  }

  const addAgain = () => {
    if (canAdd && openAdd) openAdd(ALBUM_ADD_OPTIONS)
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5" data-slot="my-photos">
      {items.length > 0 ? (
        <p className="text-body text-ink-muted tabular-nums">
          {MY_PHOTOS_COPY.summary(summary, next !== null)}
        </p>
      ) : null}

      {inbox.length > 0 ? (
        <section aria-labelledby="needs-you" className="grid gap-2">
          <h2
            id="needs-you"
            className="flex items-center gap-2 type-section-title text-ink"
          >
            {MY_PHOTOS_COPY.needsYou}
            <span className="rounded-round bg-warn-bg px-2 text-label text-warn-fg tabular-nums">
              {inbox.length}
            </span>
          </h2>
          <ul className="grid divide-y divide-line overflow-hidden rounded-card bg-surface edge">
            {inbox.map(({ item, need }) => (
              <li
                key={item.assetId}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3"
              >
                <Link
                  href={photoHref(item.assetId)}
                  aria-label={photoTitle(item)}
                  className="rounded-control focus-ring"
                >
                  <SmallThumb item={item} />
                </Link>
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-label text-ink">
                    {photoTitle(item)}
                  </span>
                  <span className="line-clamp-2 text-meta text-warn-fg">
                    {need.kind === "retake"
                      ? `${MY_PHOTOS_COPY.retake}${need.slot.reason ? `: ${need.slot.reason}` : ""}`
                      : need.kind === "no-slot"
                        ? MY_PHOTOS_COPY.noSlot
                        : MY_PHOTOS_COPY.failed}
                  </span>
                </span>
                {need.kind === "retake" ? (
                  <LinkButton
                    variant="secondary"
                    size="sm"
                    href={slotPageHref(need.slot)}
                  >
                    <ArrowUUpLeftIcon data-icon="inline-start" aria-hidden />
                    {MY_PHOTOS_COPY.retake}
                  </LinkButton>
                ) : need.kind === "no-slot" ? (
                  <LinkButton
                    variant="secondary"
                    size="sm"
                    href={photoHref(item.assetId)}
                  >
                    {MY_PHOTOS_COPY.choose}
                  </LinkButton>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!canAdd}
                    onClick={addAgain}
                  >
                    <ImagesIcon data-icon="inline-start" aria-hidden />
                    {MY_PHOTOS_COPY.addAgain}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <NeedsAttention heading={MY_PHOTOS_COPY.needsYou} bare />
        </section>
      ) : (
        // Labels the server kept but could not add are the only thing that
        // may need the person: the block brings its own Needs you heading.
        <NeedsAttention heading={MY_PHOTOS_COPY.needsYou} />
      )}

      {sending > 0 ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-card bg-info-bg px-3 py-2 text-label text-info-fg"
        >
          <ClockIcon aria-hidden className="size-5" />
          {MY_PHOTOS_COPY.sending(sending)}
        </p>
      ) : null}

      {items.length === 0 ? (
        <div className="grid justify-items-start gap-3 rounded-card border border-dashed border-line bg-surface p-4">
          <p className="text-body text-ink-muted">{MY_PHOTOS_COPY.empty}</p>
          <Button disabled={!canAdd} onClick={addAgain}>
            <ImagesIcon data-icon="inline-start" aria-hidden />
            Add photos
          </Button>
        </div>
      ) : (
        <>
          <SegmentedControl
            label="Show"
            value={show}
            onValueChange={(next) =>
              router.replace(
                next === "all" ? "/staff/photos" : `/staff/photos?show=${next}`,
                { scroll: false }
              )
            }
            options={PHOTO_SHOWS.map(({ key, label }) => ({
              value: key,
              label,
            }))}
          />

          {days.length === 0 ? (
            <p className="text-body text-ink-muted">
              {MY_PHOTOS_COPY.noneShown}
            </p>
          ) : (
            days.map((group) => (
              <section
                key={group.day}
                aria-labelledby={`day-${group.day}`}
                className="grid gap-2"
              >
                <h2
                  id={`day-${group.day}`}
                  className="flex items-baseline justify-between text-label text-ink"
                >
                  {group.label}
                  <span className="text-meta text-ink-muted tabular-nums">
                    {group.items.length}
                  </span>
                </h2>
                <ul className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1.5 md:grid-cols-[repeat(5,minmax(0,1fr))]">
                  {group.items.map((item) => (
                    <li key={item.assetId}>
                      <PhotoTile item={item} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}

          {error ? <Notice tone="negative">{error}</Notice> : null}
          {next ? (
            <Button
              variant="secondary"
              className="min-h-12"
              disabled={loading}
              onClick={() => void more()}
            >
              {MY_PHOTOS_COPY.showMore}
            </Button>
          ) : null}
        </>
      )}
    </div>
  )
}

const MARK_ICON: Record<Exclude<PhotoMark, "none">, React.ElementType> = {
  "needs-you": ExclamationMarkIcon,
  waiting: ClockIcon,
  "in-album": CheckIcon,
}

const MARK_TONE: Record<Exclude<PhotoMark, "none">, string> = {
  "needs-you": "bg-warn-bg text-warn-fg",
  waiting: "bg-info-bg text-info-fg",
  "in-album": "bg-ok-bg text-ok-fg",
}

/** One photo in the grid: the photo, its corner mark, a link to its page. */
function PhotoTile({ item }: { item: MyUpload }) {
  const mark = photoMark(item)
  const Icon = mark === "none" ? null : MARK_ICON[mark]
  return (
    <Link
      href={photoHref(item.assetId)}
      aria-label={`${photoTitle(item)}, ${MY_PHOTOS_COPY.mark[mark]}`}
      className="relative block aspect-square overflow-hidden rounded-control bg-surface-2 focus-ring"
    >
      <TileImage item={item} />
      {Icon ? (
        <span
          aria-hidden
          className={cn(
            "absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-round shadow-card",
            MARK_TONE[mark as Exclude<PhotoMark, "none">]
          )}
        >
          <Icon weight="bold" className="size-3.5" />
        </span>
      ) : null}
    </Link>
  )
}

/** The photo itself, or its kind's icon when there is no picture to show. */
function TileImage({ item }: { item: MyUpload }) {
  const [broken, setBroken] = React.useState(false)
  if (item.mediaType === "video")
    return (
      <span className="grid size-full place-items-center text-ink-muted">
        <FilmStripIcon aria-hidden className="size-7" />
      </span>
    )
  if (item.uploadState !== "ready" || broken)
    return (
      <span className="grid size-full place-items-center text-ink-muted">
        <ImageIcon aria-hidden className="size-7" />
      </span>
    )
  return (
    // Signed private URLs never go through next/image (see MediaTile).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // An error before hydration never reaches onError: check on mount too.
      ref={(el) => {
        if (el && el.complete && el.naturalWidth === 0) setBroken(true)
      }}
      src={thumbSrc(item.assetId)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className="size-full object-cover"
    />
  )
}

function SmallThumb({ item }: { item: MyUpload }) {
  return (
    <span className="block size-12 overflow-hidden rounded-control bg-surface-2">
      <TileImage item={item} />
    </span>
  )
}
