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
import { VenueBar } from "@/components/nabalens/venue-bar"
import { Button } from "@/components/ui/button"
import {
  slotHref,
  type AlbumCounts,
  type AlbumPlace,
  type AlbumSlot,
  type AlbumView,
} from "@/lib/album/model"
import { rememberAlbumPlace } from "@/lib/album/remembered-place"
import { cn } from "@/lib/utils"

import { UnfinishedRow } from "./unfinished-row"

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
  startHere = null,
  otherJobs = null,
  askedFor = null,
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
  /** Start here for a new starter (R-2), under the album count. */
  startHere?: React.ReactNode
  /** The Other jobs row (R-2), under the Match later row. */
  otherJobs?: React.ReactNode
  /**
   * A manager's open requests as slots with their brief (S2-REQ, spec §7
   * M4), under the retake row: asked-for work comes before the places.
   */
  askedFor?: React.ReactNode
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
        .filter(
          (s) => (s.state === "needed" || s.state === "retake") && !s.optional
        )
    : []

  return (
    <div className="grid gap-5 pb-4" data-slot="album-home">
      {/* v2 S1 Home: VenueBar on top, full bleed on a phone, a card beside
          the wider column (D10). */}
      <VenueBar
        name={ALBUM_COPY.albumOf(venueName)}
        className="-mx-page-gutter md:mx-0 md:rounded-card md:border md:border-line"
      />
      <section aria-labelledby="album-count" className="grid gap-2.5">
        <Title
          id="album-count"
          className="flex flex-wrap items-baseline gap-x-2"
        >
          {album.counts.empty > 0 ? (
            <>
              <span className="type-count text-ink tabular-nums">
                {album.counts.empty}
              </span>
              <span className="text-heading text-ink">
                {ALBUM_COPY.stillEmpty(album.counts.empty)}
              </span>
            </>
          ) : (
            <span className="type-display text-ink">
              {album.counts.total ? ALBUM_COPY.allFull : ALBUM_COPY.empty}
            </span>
          )}
        </Title>
        {album.counts.total > 0 ? (
          <>
            <div
              aria-hidden
              // v2 CoverageMeter bar: covered bottle, awaiting review sky,
              // on the sunken track; the line under it gives the counts.
              className="flex h-2 overflow-hidden rounded-round bg-surface-2 forced-colors:border"
            >
              <span className="bg-ok-fg" style={{ width: `${bar.filled}%` }} />
              <span
                className="bg-ok-waiting"
                style={{ width: `${bar.waiting}%` }}
              />
            </div>
            <p className="text-caption text-ink-muted tabular-nums">
              {ALBUM_COPY.line(album.counts)}
            </p>
          </>
        ) : null}
      </section>

      {startHere}

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

      {/* Photos that stopped or failed, under the retake row (spec §6 S1). */}
      {canAdd ? <UnfinishedRow /> : null}

      {blocked ? <Notice tone="attention">{blocked}</Notice> : null}

      {askedFor}

      {allPlaces.length > 0 ? (
        <section aria-labelledby="album-where" className="grid gap-2">
          <Section id="album-where" className="type-section-title text-ink">
            {ALBUM_COPY.whereAreYou}
          </Section>
          {album.places.length === 0 ? (
            <p className="text-body text-ink-muted">{ALBUM_COPY.noPlaces}</p>
          ) : null}
          {/* v2 PickChip look for each place: outlined on surface; the one
              you are at is ink fill with paper text, so it reads without
              colour. Two lines (place, empty count), so a card, not a pill. */}
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
                      "flex min-h-14 flex-col justify-center rounded-card px-4 py-1.5 focus-ring transition-colors duration-quick",
                      here
                        ? "bg-ink text-canvas"
                        : "bg-surface text-ink edge-strong hover:bg-raised"
                    )}
                  >
                    <span className="text-label">{place.label}</span>
                    <span className="text-caption tabular-nums">
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
              className="inline-flex min-h-12 items-center text-label text-accent-text underline underline-offset-4 focus-ring"
            >
              {ALBUM_COPY.allIn(current.total)}
            </Link>
          </div>
          {emptyHere.length > 0 ? (
            <ul className="grid grid-cols-2 gap-x-2 gap-y-4 min-[400px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
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

      {otherJobs}

      <div className="sticky bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+0.5rem)] z-dock md:static">
        <Button
          variant="primary"
          size="lg"
          className="min-h-14 w-full"
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
      // v2 JobCard (D10): flat surface card with a line outline, a 56px
      // thumb square, heading title, one muted line; attention is the brass
      // mark beside the words, not the card's ground.
      className="flex min-h-16 w-full items-center gap-3 rounded-card bg-surface p-4 text-start text-ink edge focus-ring transition-colors duration-quick hover:bg-raised"
    >
      <span className="flex size-14 shrink-0 items-center justify-center rounded-square bg-warn-bg slot-ring-retake">
        <ArrowUUpLeftIcon
          aria-hidden
          weight="bold"
          className="size-6 text-warn-fg"
        />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-heading text-warn-fg">
          {ALBUM_COPY.retake(retakes.length)}
        </span>
        <span className="truncate text-body text-ink-muted">
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
  // An amenity opens its question; a filled dish or place opens its slot
  // page (DESIGN.md §5: "tapping a filled slot opens the slot"; spec §6 S3).
  // FA-51: an optional slot opens its slot page too, which says it is
  // optional and still offers Add.
  if (slot.target.kind === "amenity" || !fillable || slot.optional)
    return (
      <SlotTile
        name={slot.name}
        state={slot.state}
        photoSrc={slot.thumbnailUrl ?? undefined}
        href={slotHref(slot)}
        optional={slot.optional}
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
