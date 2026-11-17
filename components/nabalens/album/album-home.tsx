"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowUUpLeftIcon,
  CaretRightIcon,
  ImagesIcon,
} from "@phosphor-icons/react"

import { SlotTile } from "@/components/nabalens/album/slot-tile"
import { Notice } from "@/components/nabalens/notice"
import { useOnline } from "@/components/nabalens/offline-notice"
import {
  useAdd,
  useAddContext,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { useObjectUrl } from "@/components/nabalens/use-upload-queue"
import { Button } from "@/components/ui/button"
import type {
  AlbumCounts,
  AlbumPlace,
  AlbumSlot,
  AlbumView,
} from "@/lib/album/model"
import { rememberAlbumPlace } from "@/lib/album/remembered-place"
import { cn } from "@/lib/utils"

/*
 * Album, the staff Home (DESIGN.md §5a). Top to bottom: the venue's album
 * count, the retake row, "Where are you?" with the places, the empty slots
 * where the person is, and one main button that opens the gallery. Nothing
 * else: no feed, no personal month, no ranking (§9).
 *
 * The current place is the one this phone last opened (a chip here, or a
 * place's own screen), else the place with most empty slots (§5a step 3);
 * the page reads it from `lib/server/album-place.ts`.
 *
 * Adding is gallery first (§2, D9). A Needed dish or area slot opens the
 * gallery for one photo that goes straight to it; an amenity slot opens its
 * question. The main button opens the gallery for many, then Match (§6.1).
 */

export const ALBUM_COPY = {
  albumOf: (venue: string) => `${venue} album`,
  stillEmpty: (n: number) =>
    n === 1 ? "slot still empty" : "slots still empty",
  allFull: "Every slot has a photo",
  line: (c: AlbumCounts) =>
    `${c.filled} in · ${c.waiting} waiting · ${c.total} in all`,
  whereAreYou: "Where are you?",
  emptyIn: (place: string) => `Empty at ${place}`,
  emptyCount: (n: number) => `${n} empty`,
  allIn: (n: number) => `All ${n}`,
  nothingEmptyHere: (place: string) =>
    `Nothing is empty at ${place}. Choose another place.`,
  addMain: "Add photos from your gallery",
  retake: (n: number) => (n === 1 ? "1 retake" : `${n} retakes`),
  noPlaces:
    "Your manager hasn't said where each part of the menu is photographed yet, so every slot is under Not placed yet.",
  empty:
    "Nothing to photograph yet. When your venue has an active menu, its dishes appear here.",
}

export type AlbumRetake = {
  itemId: string
  itemName: string
  reason: string | null
}

function countBar(counts: AlbumCounts) {
  const pct = (n: number) => (counts.total ? (n / counts.total) * 100 : 0)
  return { filled: pct(counts.filled), waiting: pct(counts.waiting) }
}

export function AlbumHome({
  venueName,
  album,
  current,
  retakes,
  canAdd,
  headingLevel = 1,
  blocked,
  matchLater = null,
}: {
  venueName: string
  album: AlbumView
  current: AlbumPlace | null
  retakes: AlbumRetake[]
  canAdd: boolean
  /** The screen's title level; 1 on a page, deeper when embedded (the dev gallery). */
  headingLevel?: 1 | 2 | 3 | 4
  blocked: string | null
  /** The Match later row (§5a step 5), between the empty slots and the main button. */
  matchLater?: React.ReactNode
}) {
  const openAdd = useAdd()
  const Title = `h${headingLevel}` as "h1"
  const Section = `h${headingLevel + 1}` as "h2"
  const add = (opts: OpenAddOptions) => {
    if (canAdd && openAdd) openAdd(opts)
  }
  const bar = countBar(album.counts)
  const allPlaces = [
    ...album.places,
    ...(album.unplaced ? [album.unplaced] : []),
  ]
  const emptyHere = current
    ? current.groups
        .flatMap((g) => g.slots)
        .filter((s) => s.state === "needed" || s.state === "retake")
    : []

  return (
    <div className="grid gap-5 pb-4" data-slot="album-home">
      <section aria-labelledby="album-count" className="grid gap-2.5">
        <p className="font-mono text-mono font-semibold text-ink-muted">
          {ALBUM_COPY.albumOf(venueName)}
        </p>
        <Title
          id="album-count"
          className="flex flex-wrap items-baseline gap-x-2"
        >
          {album.counts.empty > 0 ? (
            <>
              <span className="type-count text-ink tabular-nums">
                {album.counts.empty}
              </span>
              <span className="type-section-title text-ink">
                {ALBUM_COPY.stillEmpty(album.counts.empty)}
              </span>
            </>
          ) : (
            <span className="type-page-title text-ink">
              {album.counts.total ? ALBUM_COPY.allFull : ALBUM_COPY.empty}
            </span>
          )}
        </Title>
        {album.counts.total > 0 ? (
          <>
            <div
              aria-hidden
              className="flex h-3 overflow-hidden rounded-round bg-surface-2"
            >
              <span className="bg-ok-fg" style={{ width: `${bar.filled}%` }} />
              <span
                className="bg-ok-waiting"
                style={{ width: `${bar.waiting}%` }}
              />
            </div>
            <p className="font-mono text-mono font-semibold text-ink-muted tabular-nums">
              {ALBUM_COPY.line(album.counts)}
            </p>
          </>
        ) : null}
      </section>

      {retakes.length > 0 ? (
        <RetakeRow
          retakes={retakes}
          onRetake={(r) =>
            add({
              source: "library",
              imagesOnly: true,
              preset: {
                itemId: r.itemId,
                variantId: null,
                itemName: r.itemName,
                variantName: null,
              },
            })
          }
        />
      ) : null}

      {blocked ? <Notice tone="attention">{blocked}</Notice> : null}

      {allPlaces.length > 0 ? (
        <section aria-labelledby="album-where" className="grid gap-2">
          <Section id="album-where" className="type-section-title text-ink">
            {ALBUM_COPY.whereAreYou}
          </Section>
          {album.places.length === 0 ? (
            <p className="text-body text-ink-muted">{ALBUM_COPY.noPlaces}</p>
          ) : null}
          <ul className="-mx-page-gutter flex gap-2 overflow-x-auto px-page-gutter pb-1">
            {allPlaces.map((place) => {
              const here = place.subjectId === current?.subjectId
              return (
                <li key={place.subjectId ?? "unplaced"} className="shrink-0">
                  <Link
                    href={`?place=${place.subjectId ?? "unplaced"}`}
                    scroll={false}
                    onClick={() =>
                      rememberAlbumPlace(place.subjectId ?? "unplaced")
                    }
                    aria-current={here ? "true" : undefined}
                    className={cn(
                      "flex min-h-16 flex-col justify-center rounded-card px-3.5 py-1.5 focus-ring",
                      here
                        ? "bg-accent-soft text-accent-text inset-ring-2 inset-ring-accent"
                        : "bg-surface text-ink shadow-card"
                    )}
                  >
                    <span className="text-label">{place.label}</span>
                    <span className="font-mono text-mono font-semibold">
                      {ALBUM_COPY.emptyCount(place.empty)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {current ? (
        <section aria-labelledby="album-here" className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <Section id="album-here" className="type-section-title text-ink">
              {ALBUM_COPY.emptyIn(current.label)}
            </Section>
            <Link
              href={`/staff/album/${current.subjectId ?? "unplaced"}`}
              onClick={() =>
                rememberAlbumPlace(current.subjectId ?? "unplaced")
              }
              className="inline-flex min-h-12 items-center font-bold text-accent-text underline underline-offset-4 focus-ring"
            >
              {ALBUM_COPY.allIn(current.total)}
            </Link>
          </div>
          {emptyHere.length > 0 ? (
            <ul className="grid grid-cols-3 gap-2">
              {emptyHere.slice(0, 6).map((slot) => (
                <li key={slot.id}>
                  <AlbumSlotTile slot={slot} add={add} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-ink-muted">
              {ALBUM_COPY.nothingEmptyHere(current.label)}
            </p>
          )}
        </section>
      ) : null}

      {matchLater}

      <div className="sticky bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+0.5rem)] z-dock md:static">
        <Button
          variant="primary"
          size="lg"
          className="min-h-16 w-full"
          disabled={!canAdd}
          onClick={() =>
            add({
              match: {
                place: current ? (current.subjectId ?? "unplaced") : null,
              },
            })
          }
        >
          <ImagesIcon data-icon="inline-start" aria-hidden />
          {ALBUM_COPY.addMain}
        </Button>
      </div>
    </div>
  )
}

function RetakeRow({
  retakes,
  onRetake,
}: {
  retakes: AlbumRetake[]
  onRetake: (r: AlbumRetake) => void
}) {
  const first = retakes[0]
  return (
    <button
      type="button"
      onClick={() => onRetake(first)}
      className="flex min-h-16 w-full items-center gap-3 rounded-card bg-warn-bg px-3 py-2 text-start text-ink focus-ring"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-control bg-surface slot-ring-retake">
        <ArrowUUpLeftIcon
          aria-hidden
          weight="bold"
          className="size-6 text-warn-fg"
        />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-label text-warn-fg">
          {ALBUM_COPY.retake(retakes.length)}
        </span>
        <span className="truncate text-body">
          {first.itemName}
          {first.reason ? `: ${first.reason}` : ""}
        </span>
      </span>
      <CaretRightIcon aria-hidden className="size-5 shrink-0" />
    </button>
  )
}

/**
 * One slot as a tile that knows how to add to itself (§6.1). A slot this
 * phone matched a photo to shows that photo as Sending (Saved on this phone
 * without a signal), then Waiting, until the album reads it (§4, §6.8): it
 * can't be tapped meanwhile, so a slot is never sent twice.
 */
export function AlbumSlotTile({
  slot,
  add,
}: {
  slot: AlbumSlot
  add: (opts: OpenAddOptions) => void
}) {
  const fillable = slot.state === "needed" || slot.state === "retake"
  const addContext = useAddContext()
  const send = addContext?.slots?.get(slot.id)
  const settleSlot = addContext?.settleSlot
  const online = useOnline()
  const sentSrc = useObjectUrl(fillable && send ? send.file : null)
  // Once the album reads the slot as filled or waiting, the phone's own
  // state is no longer needed (a later retake shows as Retake).
  React.useEffect(() => {
    if (send && !fillable) settleSlot?.(slot.id)
  }, [send, fillable, settleSlot, slot.id])
  if (fillable && send)
    return (
      <SlotTile
        name={slot.name}
        state={send.state}
        photoSrc={sentSrc ?? undefined}
        offline={send.state === "sending" && !online}
      />
    )
  if (slot.target.kind === "amenity")
    return (
      <SlotTile
        name={slot.name}
        state={slot.state}
        photoSrc={slot.thumbnailUrl ?? undefined}
        href={`/staff/tasks/amenities/${slot.target.checkId}`}
      />
    )
  if (!fillable)
    return (
      <SlotTile
        name={slot.name}
        state={slot.state}
        photoSrc={slot.thumbnailUrl ?? undefined}
      />
    )
  const target = slot.target
  return (
    <SlotTile
      name={slot.name}
      state={slot.state}
      onSelect={() =>
        add({
          slot:
            target.kind === "dish"
              ? { kind: "dish", itemId: target.itemId, name: target.itemName }
              : { kind: "area", subjectId: target.subjectId, name: slot.name },
        })
      }
    />
  )
}
