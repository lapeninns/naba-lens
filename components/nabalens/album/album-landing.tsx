"use client"

import type * as React from "react"
import Link from "next/link"
import { CaretRightIcon, CheckIcon } from "@phosphor-icons/react"

import { AlbumSearch } from "@/components/nabalens/album/album-home"
import {
  PlaceLensPills,
  type LensPlace,
} from "@/components/nabalens/album/album-lens"
import { Notice } from "@/components/nabalens/notice"
import {
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { Photo } from "@/components/ui/photo"
import type { AlbumPlace } from "@/lib/album/model"
import {
  ALBUM_PARTS,
  albumParts,
  emptyPart,
  type AlbumPart,
  type PlaceLens,
  type ShelfView,
} from "@/lib/album/shelves"

/*
 * Album's landing (DESIGN.md §5d "Album landing"): the venue's count, search,
 * the place lens, then one card per part (Menu, Amenities, Spaces) with its bar, photo strip and
 * shelves. The album belongs to the venue (§9): no ranking, no feed.
 */

export const LANDING_COPY = {
  albumOf: (venue: string) => `${venue} album`,
  stillEmpty: (n: number) => `${n} ${n === 1 ? "slot" : "slots"} still empty`,
  allFull: "Every slot has a photo",
  nothingYet:
    "Nothing to photograph yet. When your venue has an active menu, its dishes appear here.",
  stillEmptyOf: (empty: number, total: number) =>
    total === 0
      ? "Nothing to photograph here yet."
      : empty > 0
        ? `${empty} still empty of ${total}`
        : "All in",
  nothingAt: (place: string) => `Nothing at ${place} yet. Choose All places.`,
}

export function AlbumLanding({
  venueName,
  view,
  lens,
  places,
  searchPlaces,
  canAdd,
  blocked,
  matchLater = null,
}: {
  venueName: string
  /** The album under the lens. */
  view: ShelfView
  lens: PlaceLens
  places: LensPlace[]
  /** The whole album, for search (§6.1a MT-1). */
  searchPlaces: AlbumPlace[]
  canAdd: boolean
  blocked: string | null
  matchLater?: React.ReactNode
}) {
  const openAdd = useAdd()
  const add = (opts: OpenAddOptions) => {
    if (canAdd && openAdd) openAdd(opts)
  }
  const lensLabel = places.find((p) => p.id === lens)?.label ?? ""

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] gap-5 pb-4"
      data-slot="album-landing"
    >
      <div className="grid gap-1">
        <h1 className="type-page-title text-ink">
          {LANDING_COPY.albumOf(venueName)}
        </h1>
        <p className="text-body text-ink-muted tabular-nums">
          {view.empty > 0
            ? LANDING_COPY.stillEmpty(view.empty)
            : view.total > 0
              ? LANDING_COPY.allFull
              : lens
                ? LANDING_COPY.nothingAt(lensLabel)
                : LANDING_COPY.nothingYet}
        </p>
      </div>

      {blocked ? <Notice tone="attention">{blocked}</Notice> : null}

      {searchPlaces.length > 0 ? (
        <AlbumSearch places={searchPlaces} add={add} quiet />
      ) : null}

      <PlaceLensPills
        places={places}
        lens={lens}
        href={(id) =>
          id ? `/staff/album?place=${encodeURIComponent(id)}` : "/staff/album"
        }
      />

      <ul className="grid gap-3">
        {/* All three parts on the whole album, an empty one saying so
            (§5d landing step 4); under a place, only parts with slots. */}
        {ALBUM_PARTS.flatMap(({ key }) => {
          const part = albumParts(view).find((p) => p.key === key)
          return part ? [part] : lens ? [] : [emptyPart(key)]
        }).map((part) => (
          <li key={part.key}>
            <PartCard part={part} lens={lens} />
          </li>
        ))}
      </ul>

      {matchLater}
    </div>
  )
}

/** Links into a part (§5d landing step 4): Menu's types, else its shelves. */
function partLinks(part: AlbumPart, href: string, lens: PlaceLens) {
  const place = lens ? `&place=${encodeURIComponent(lens)}` : ""
  if (part.key === "menu")
    return part.types.map((t) => ({
      key: t.category,
      label: t.label,
      empty: t.empty,
      href: `/staff/album/menu?kind=${t.category}${place}`,
    }))
  if (part.shelves.length < 2) return []
  return part.shelves.map((shelf) => ({
    key: shelf.key,
    label: shelf.label,
    empty: shelf.empty,
    href: `/staff/album/${part.key}?shelf=${encodeURIComponent(shelf.key)}${place}`,
  }))
}

function PartCard({ part, lens }: { part: AlbumPart; lens: PlaceLens }) {
  const href = `/staff/album/${part.key}${lens ? `?place=${encodeURIComponent(lens)}` : ""}`
  const links = partLinks(part, href, lens)
  const pct = (n: number) => (part.total ? (n / part.total) * 100 : 0)
  return (
    <section
      aria-labelledby={`part-${part.key}`}
      className="grid gap-3 rounded-card bg-surface p-4 edge"
    >
      <Link href={href} className="group grid gap-2 rounded-control focus-ring">
        <span className="flex items-baseline justify-between gap-3">
          <h2
            id={`part-${part.key}`}
            className="type-section-title text-ink group-hover:underline"
          >
            {part.label}
          </h2>
          <CaretRightIcon aria-hidden className="size-5 shrink-0" />
        </span>
        <span className="text-body text-ink-muted tabular-nums">
          {LANDING_COPY.stillEmptyOf(part.empty, part.total)}
        </span>
        {part.total > 0 ? (
          <span
            aria-hidden
            className="flex h-2 overflow-hidden rounded-round bg-surface-2 forced-colors:border"
          >
            <span
              className="bg-ok-fg"
              style={{ width: `${pct(part.filled)}%` }}
            />
            <span
              className="bg-ok-waiting"
              style={{ width: `${pct(part.waiting)}%` }}
            />
          </span>
        ) : null}
      </Link>

      {part.covers.length > 0 ? (
        <ul aria-hidden className="grid grid-cols-4 gap-1.5">
          {part.covers.map((src) => (
            <li key={src}>
              <Photo alt="" ratio="1/1" src={src} />
            </li>
          ))}
        </ul>
      ) : null}

      {links.length > 0 ? (
        <ul className="flex flex-wrap gap-x-1 gap-y-1">
          {links.map((link) => (
            <li key={link.key}>
              <Link
                href={link.href}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-round px-3 text-label text-ink edge focus-ring hover:bg-raised"
              >
                {link.label}
                {link.empty > 0 ? (
                  <span className="text-caption text-ink-muted tabular-nums">
                    {link.empty}
                    <span className="sr-only"> empty</span>
                  </span>
                ) : (
                  <span className="text-caption text-ok-fg">
                    <CheckIcon aria-hidden weight="bold" className="size-4" />
                    <span className="sr-only">All in</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
