"use client"

import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import type { PlaceLens } from "@/lib/album/shelves"

/*
 * Shared by Album's landing and a type (DESIGN.md §5d "Place is a lens"):
 * the place chips and the id each shelf's heading has.
 */

export const LENS_COPY = {
  whereAreYou: "Where are you?",
  allPlaces: "All places",
}

/** The id a shelf's heading has, for the jump bar and the landing's links. */
export function shelfAnchor(key: string): string {
  return `shelf-${key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
}

export type LensPlace = { id: string; label: string; empty: number }

/** "Where are you?" (§5d "Place is a lens"): All places, then each place. */
export function PlaceLensPills({
  places,
  lens,
  href,
  wrap = false,
}: {
  places: LensPlace[]
  lens: PlaceLens
  href: (id: string | null) => string
  /** In a sheet: the chips wrap instead of scrolling sideways. */
  wrap?: boolean
}) {
  if (places.length < 2) return null
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <h2 id="album-lens" className="text-label text-ink-muted">
        {LENS_COPY.whereAreYou}
      </h2>
      <PillGroup
        aria-labelledby="album-lens"
        className={
          wrap
            ? undefined
            : "-mx-page-gutter flex-nowrap overflow-x-auto px-page-gutter pb-1"
        }
      >
        <FilterPill
          href={href(null)}
          selected={lens === null}
          current="true"
          scroll={false}
          replace
          className="shrink-0"
        >
          {LENS_COPY.allPlaces}
        </FilterPill>
        {places.map((p) => (
          <FilterPill
            key={p.id}
            href={href(p.id)}
            selected={lens === p.id}
            current="true"
            scroll={false}
            replace
            count={p.empty}
            className="shrink-0"
          >
            {p.label}
          </FilterPill>
        ))}
      </PillGroup>
    </div>
  )
}
