"use client"

import Link from "next/link"
import { ArrowLeftIcon, ImagesIcon } from "@phosphor-icons/react"

import { AlbumSlotTile } from "@/components/nabalens/album/album-home"
import {
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { Button } from "@/components/ui/button"
import type { AlbumPlace } from "@/lib/album/model"

/*
 * One place in the album (DESIGN.md §6.2): every slot there, by section, each
 * with its "filled of total" count, and the main button that adds photos.
 */
export function AlbumPlaceScreen({
  venueName,
  place,
  canAdd,
  headingLevel = 1,
}: {
  venueName: string
  place: AlbumPlace
  canAdd: boolean
  /** The screen's title level; 1 on a page, deeper when embedded (the dev gallery). */
  headingLevel?: 1 | 2 | 3 | 4
}) {
  const openAdd = useAdd()
  const Title = `h${headingLevel}` as "h1"
  const Section = `h${headingLevel + 1}` as "h2"
  const add = (opts: OpenAddOptions) => {
    if (canAdd && openAdd) openAdd(opts)
  }
  return (
    <div className="grid gap-5 pb-4" data-slot="album-place">
      <div>
        <Link
          href={`/staff/tasks?place=${place.subjectId ?? "unplaced"}`}
          className="inline-flex min-h-12 items-center gap-1 font-bold text-ink focus-ring"
        >
          <ArrowLeftIcon aria-hidden className="size-5" />
          Album
        </Link>
      </div>
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="grid gap-0.5">
          <p className="font-mono text-mono font-semibold text-ink-muted">
            {venueName}
          </p>
          <Title className="type-page-title text-ink">{place.label}</Title>
        </div>
        <p className="font-mono text-mono font-semibold text-ink-muted tabular-nums">
          {place.empty} empty of {place.total}
        </p>
      </header>

      {place.groups.map((group) => (
        <section
          key={group.name}
          aria-labelledby={`group-${group.name}`}
          className="grid gap-2"
        >
          <div className="flex items-baseline justify-between gap-3">
            <Section
              id={`group-${group.name}`}
              className="type-section-title text-ink"
            >
              {group.name}
            </Section>
            <span className="font-mono text-mono font-semibold text-ink-muted tabular-nums">
              {group.filled} of {group.total}
            </span>
          </div>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {group.slots.map((slot) => (
              <li key={slot.id} className="grid content-start gap-1">
                <AlbumSlotTile slot={slot} add={add} />
                {slot.neededBy ? (
                  <span className="text-meta text-ink-muted">
                    {slot.neededBy}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {place.empty > 0 ? (
        <div className="sticky bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+0.5rem)] z-dock md:static">
          <Button
            variant="primary"
            size="lg"
            className="min-h-16 w-full"
            disabled={!canAdd}
            onClick={() =>
              add({ match: { place: place.subjectId ?? "unplaced" } })
            }
          >
            <ImagesIcon data-icon="inline-start" aria-hidden />
            {place.empty === 1
              ? "Add a photo for the empty slot"
              : `Add photos for these ${place.empty} slots`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
