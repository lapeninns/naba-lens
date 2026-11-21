"use client"

import { useId, useState } from "react"
import Link from "next/link"
import {
  ArrowLeftIcon,
  ImagesIcon,
  MegaphoneSimpleIcon,
} from "@phosphor-icons/react"

import { AlbumSlotTile } from "@/components/nabalens/album/album-home"
import {
  ReportChangeDialog,
  type ReportSender,
} from "@/components/nabalens/album/report-change-dialog"
import { Notice } from "@/components/nabalens/notice"
import { VenueBar } from "@/components/nabalens/venue-bar"
import {
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { Button } from "@/components/ui/button"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import {
  ALBUM_SHOWS,
  COVERAGE_CATEGORIES,
  filterPlace,
  placeCategories,
  type AlbumPlace,
  type AlbumShow,
  type CoverageCategory,
} from "@/lib/album/model"
import { rememberAlbumShow } from "@/lib/album/remembered-place"
import {
  ALBUM_UPLOAD_TRAY,
  STAFF_PHOTO_ROUTES,
} from "@/lib/config/album-upload-tray"
import { REPORT_COPY } from "@/lib/staff/slot-reports"

/*
 * One place in the album (DESIGN.md §6.2): every slot there, by section, each
 * with its "filled of total" count, and the main button that adds photos.
 *
 * Filters (spec §6 S3, FA-6, FA-7; S2-STAFF): the spec's categories (Food,
 * Drinks, Spaces, Facilities, Other) present in the place, and the states in
 * Album's words: Needed, Waiting, In the album, Retake or needs checking,
 * All (the tiles' own words, SLOT_MARK_WORDS). Both
 * live in the URL (`?show=`, `?cat=`). A state the person chooses here is
 * remembered on the phone; a prompt opens the place with `?show=needed`.
 * Counts never change with a filter. A tile shows how many photos wait for
 * review on it, never a colleague's unreviewed photo (FA-20).
 */

export const PLACE_COPY = {
  stateFilter: "Show",
  categoryFilter: "Category",
  allCategories: "Everything",
  nothingHere: "No slots here match these filters. Choose another filter.",
  waiting: (n: number) => `${n} waiting`,
}

export type PlaceFilter = {
  show: AlbumShow
  category: CoverageCategory | null
}

export const DEFAULT_PLACE_FILTER: PlaceFilter = { show: "all", category: null }

/** The URL of this place with a filter (the default one leaves it clean). */
export function placeFilterHref(placeKey: string, filter: PlaceFilter): string {
  const params = new URLSearchParams()
  if (filter.show !== "all") params.set("show", filter.show)
  if (filter.category) params.set("cat", filter.category)
  const query = params.toString()
  return `/staff/album/${placeKey}${query ? `?${query}` : ""}`
}

export function AlbumPlaceScreen({
  venueName,
  place,
  canAdd,
  filter = DEFAULT_PLACE_FILTER,
  sendReport,
  headingLevel = 1,
}: {
  venueName: string
  place: AlbumPlace
  canAdd: boolean
  filter?: PlaceFilter
  /** Report a change on one of this place's slots (spec §6 S3). */
  sendReport?: ReportSender
  /** The screen's title level; 1 on a page, deeper when embedded (the dev gallery). */
  headingLevel?: 1 | 2 | 3 | 4
}) {
  const openAdd = useAdd()
  // Section names have spaces ("Games and amenities"), and aria-labelledby
  // reads an id with spaces as several ids: name each heading by index.
  const idBase = useId()
  const Title = `h${headingLevel}` as "h1"
  const Section = `h${headingLevel + 1}` as "h2"
  const add = (opts: OpenAddOptions) => {
    if (canAdd && openAdd) openAdd(opts)
  }
  const placeKey = place.subjectId ?? "unplaced"
  const categories = placeCategories(place)
  const shown = filterPlace(place, filter)
  const [reporting, setReporting] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const choices = place.groups.flatMap((g) =>
    g.slots.map((slot) => ({
      kind: slot.target.kind,
      subjectId:
        slot.target.kind === "dish"
          ? slot.target.itemId
          : slot.target.kind === "area"
            ? slot.target.subjectId
            : slot.target.checkId,
      name: slot.name,
    }))
  )
  return (
    <div className="grid gap-5 pb-4" data-slot="album-place">
      <VenueBar
        name={venueName}
        className="-mx-page-gutter max-md:hidden md:mx-0 md:rounded-card md:border md:border-line"
      />
      <div className="-mt-3">
        <Link
          href={`${ALBUM_UPLOAD_TRAY ? STAFF_PHOTO_ROUTES.album : "/staff/tasks"}?place=${placeKey}`}
          className="inline-flex min-h-12 items-center gap-1 text-label text-ink focus-ring"
        >
          <ArrowLeftIcon aria-hidden className="size-5" />
          Album
        </Link>
      </div>
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <Title className="type-display text-ink">{place.label}</Title>
        <p className="text-caption text-ink-muted tabular-nums">
          {place.empty} empty of {place.total}
        </p>
      </header>

      <div className="grid gap-2" data-slot="album-place-filters">
        <PillGroup label={PLACE_COPY.stateFilter}>
          {ALBUM_SHOWS.map(({ key, label }) => (
            <FilterPill
              key={key}
              href={placeFilterHref(placeKey, { ...filter, show: key })}
              scroll={false}
              replace
              current="true"
              selected={filter.show === key}
              onClick={() => rememberAlbumShow(key)}
            >
              {label}
            </FilterPill>
          ))}
        </PillGroup>
        {categories.length > 1 ? (
          <PillGroup label={PLACE_COPY.categoryFilter}>
            <FilterPill
              href={placeFilterHref(placeKey, { ...filter, category: null })}
              scroll={false}
              replace
              current="true"
              selected={filter.category === null}
            >
              {PLACE_COPY.allCategories}
            </FilterPill>
            {COVERAGE_CATEGORIES.filter((c) => categories.includes(c.key)).map(
              ({ key, label }) => (
                <FilterPill
                  key={key}
                  href={placeFilterHref(placeKey, { ...filter, category: key })}
                  scroll={false}
                  replace
                  current="true"
                  selected={filter.category === key}
                >
                  {label}
                </FilterPill>
              )
            )}
          </PillGroup>
        ) : null}
      </div>

      {shown.groups.length === 0 ? (
        <p className="text-body text-ink-muted" role="status">
          {PLACE_COPY.nothingHere}
        </p>
      ) : null}

      {shown.groups.map((group, index) => {
        const whole = place.groups.find((g) => g.name === group.name) ?? group
        return (
          <section
            key={group.name}
            aria-labelledby={`${idBase}-group-${index}`}
            className="grid gap-2"
          >
            <div className="flex items-baseline justify-between gap-3">
              <Section
                id={`${idBase}-group-${index}`}
                className="type-section-title text-ink"
              >
                {group.name}
              </Section>
              <span className="text-caption text-ink-muted tabular-nums">
                {whole.filled} of {whole.total}
              </span>
            </div>
            {/* v2 SubjectCard grid: space-2 across, space-4 down. */}
            <ul className="grid grid-cols-2 gap-x-2 gap-y-4 min-[400px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {group.slots.map((slot) => (
                <li key={slot.id} className="grid content-start gap-1">
                  <AlbumSlotTile slot={slot} add={add} />
                  {slot.neededBy ? (
                    <span className="text-meta text-ink-muted">
                      {slot.neededBy}
                    </span>
                  ) : null}
                  {slot.pendingCount > 0 ? (
                    <span
                      className="text-caption text-ink-muted tabular-nums"
                      data-slot="slot-pending-count"
                    >
                      {PLACE_COPY.waiting(slot.pendingCount)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {sent ? (
        <Notice tone="positive" role="status">
          {sent}
        </Notice>
      ) : null}
      {sendReport && choices.length > 0 ? (
        <div>
          <Button variant="secondary" onClick={() => setReporting(true)}>
            <MegaphoneSimpleIcon data-icon="inline-start" aria-hidden />
            {REPORT_COPY.slotTitle}
          </Button>
          <ReportChangeDialog
            open={reporting}
            onOpenChange={setReporting}
            choices={choices}
            send={sendReport}
            onSent={(created, subject) =>
              setSent(
                `${subject.name}: ${created ? REPORT_COPY.sent : REPORT_COPY.alreadySent}`
              )
            }
          />
        </div>
      ) : null}

      {place.empty > 0 ? (
        <div className="sticky bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+0.5rem)] z-dock md:static">
          <Button
            variant="primary"
            size="lg"
            className="min-h-14 w-full"
            disabled={!canAdd}
            onClick={() => add({ match: { place: placeKey } })}
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
