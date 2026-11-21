"use client"

import { EmptyState } from "@/components/nabalens/empty-state"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckIcon, FunnelSimpleIcon, ImagesIcon } from "@phosphor-icons/react"

import { AlbumSlotTile } from "@/components/nabalens/album/album-home"
import { CheckProgressChip } from "@/components/nabalens/amenities/manage/check-row"
import { BackLink } from "@/components/nabalens/back-link"
import { ActionDock } from "@/components/nabalens/common-room/action-dock"
import { Row, RowList } from "@/components/nabalens/common-room/row"
import { SectionHeader } from "@/components/nabalens/common-room/section"
import { Notice } from "@/components/nabalens/notice"
import {
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import { Photo } from "@/components/ui/photo"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { ANSWER_LABEL } from "@/lib/amenities/contract"
import {
  ALBUM_SHOWS,
  slotHref,
  slotMatchesShow,
  type AlbumShow,
  type AlbumSlot,
} from "@/lib/album/model"
import type {
  AlbumPart as AlbumPartView,
  AlbumType,
  PlaceLens,
  Shelf as AlbumShelf,
} from "@/lib/album/shelves"
import { sectionAnchor } from "@/lib/album/shelves"
import { cn } from "@/lib/utils"

import { LENS_COPY, PlaceLensPills, type LensPlace } from "./album-lens"

/*
 * One part of the album (DESIGN.md §5d "A part"): Menu (with its Food |
 * Drinks switch), Amenities or Spaces. The filter row, a sticky jump bar of
 * shelves, then each shelf and its sections as slot tiles (three-up; Spaces
 * two-up, as rooms are wide), with a Done mark on a finished section (§2
 * principle 6). Amenities lists its questions as rows by group, each with
 * its answer line and one chip: the thing to read is the question, not a
 * photo (screens-2 handoff). Adding is gallery first (§2, D9): a Needed tile
 * opens the gallery for its slot; the main button opens it for many, then
 * Match (§6.1).
 */

export const PART_COPY = {
  back: "Album",
  stillEmptyOf: (empty: number, total: number) =>
    total === 0
      ? "Nothing to photograph here yet."
      : empty > 0
        ? `${empty} still empty of ${total}`
        : "All in",
  shelfEmpty: (n: number) => (n > 0 ? `${n} empty` : "All in"),
  toAdd: (n: number) => (n > 0 ? `${n} to add` : "Nothing to add"),
  folderCount: (filled: number, total: number, empty: number) =>
    total === 0
      ? "Nothing yet"
      : empty === 0
        ? `All ${total} in`
        : filled === 0
          ? `Nothing yet · ${empty} to add`
          : `${filled} of ${total} in · ${empty} empty`,
  sectionCount: (filled: number, total: number) => `${filled} of ${total}`,
  done: "Done",
  filter: "Filter",
  clear: "Clear",
  showTitle: "Show",
  noneShown: "Nothing here matches this filter. Choose All to see every slot.",
  addMain: "Add photos from your gallery",
  questionsOf: (open: number, total: number) =>
    total === 0
      ? "No questions here yet."
      : open > 0
        ? `${open} ${open === 1 ? "question" : "questions"} still to answer of ${total}`
        : "Every question answered",
  answeredOf: (answered: number, total: number) => `${answered} of ${total}`,
  noQuestions: "No amenity questions yet",
  noQuestionsText:
    "Your manager chooses which amenities to check. Their questions will appear here.",
  needsPhoto: "A Yes needs a photo",
  recheck: "Your manager asked for a recheck",
  waiting: "Your answer is waiting for your manager",
  currentAnswer: (answer: string) => `Current answer: ${answer}`,
}

/** The one line under an amenity question (screens-2 handoff). */
export function questionLine(slot: AlbumSlot): string | null {
  const q = slot.question
  // An Other slot that is not a question (a dish or space filed there).
  if (slot.target.kind !== "amenity") return null
  if (slot.state === "waiting") return PART_COPY.waiting
  if (q?.progress === "needs_recheck") return PART_COPY.recheck
  if (q?.progress === "complete" && q.answer)
    return PART_COPY.currentAnswer(ANSWER_LABEL[q.answer])
  return PART_COPY.needsPhoto
}

function query(
  lens: PlaceLens,
  show: AlbumShow | null,
  kind: string | null = null,
  shelf: string | null = null
): string {
  const q = new URLSearchParams()
  if (kind) q.set("kind", kind)
  if (shelf) q.set("shelf", shelf)
  if (lens) q.set("place", lens)
  if (show) q.set("show", show)
  const s = q.toString()
  return s ? `?${s}` : ""
}

export function AlbumPart({
  part,
  type,
  shelfKey,
  show,
  defaultShow,
  posting = false,
  lens,
  places,
  canAdd,
  blocked,
}: {
  part: AlbumPartView
  /** Menu's chosen type (Food or Drinks); null for a part with no switch. */
  type: AlbumType | null
  /** The shelf opened as a folder (`?shelf=`), else the folders. */
  shelfKey: string | null
  show: AlbumShow
  /** What the part opens on without `?show=` (§5d "A part" step 3). */
  defaultShow: AlbumShow
  posting?: boolean
  lens: PlaceLens
  places: LensPlace[]
  canAdd: boolean
  blocked: string | null
}) {
  const router = useRouter()
  const openAdd = useAdd()
  const add = (opts: OpenAddOptions) => {
    if (canAdd && openAdd) openAdd(opts)
  }
  const base = `/staff/album/${part.key}`
  // Menu shows one type at a time; Amenities and Spaces list every shelf.
  const switched = part.key === "menu" && type !== null
  const kind = switched ? type.category : null
  const allShelves = switched ? type.shelves : part.shelves
  // Amenities lists every question by group, never folders.
  const questions = part.key === "amenities"
  // A part with one shelf (Spaces) opens straight onto it; otherwise the
  // shelves are folders until one is chosen (§5d "A part" steps 4 and 5).
  const open = questions
    ? null
    : (allShelves.find((s) => s.key === shelfKey) ??
      (allShelves.length === 1 ? allShelves[0]! : null))
  const folders = open === null && !questions
  const sections = (open?.sections ?? [])
    .map((section) => ({
      ...section,
      shown: section.slots.filter((slot) => slotMatchesShow(slot, show)),
    }))
    .filter((section) => section.shown.length > 0)
  const href = (
    over: Partial<{
      lens: PlaceLens
      show: AlbumShow | null
      kind: string | null
      shelf: string | null
    }> = {}
  ) =>
    `${base}${query(
      "lens" in over ? over.lens! : lens,
      "show" in over ? over.show! : show === defaultShow ? null : show,
      "kind" in over ? over.kind! : kind,
      "shelf" in over
        ? over.shelf!
        : open && allShelves.length > 1
          ? open.key
          : null
    )}`
  const inView = useShelfInView(sections.map((s) => sectionAnchor(s.key)))
  const barRef = React.useRef<HTMLUListElement>(null)
  // Keep the marked section visible in the jump bar as the page scrolls.
  React.useEffect(() => {
    const chip = barRef.current?.querySelector<HTMLElement>(
      '[aria-current="true"]'
    )
    const bar = barRef.current
    if (!chip || !bar) return
    const left = chip.offsetLeft - bar.offsetLeft
    if (
      left < bar.scrollLeft ||
      left + chip.offsetWidth > bar.scrollLeft + bar.clientWidth
    )
      bar.scrollTo({ left: Math.max(0, left - 16), behavior: "smooth" })
  }, [inView])

  const backToFolders = open !== null && allShelves.length > 1
  const head = open ?? part
  const eyebrow = open
    ? [part.label, switched && part.types.length > 1 ? type.label : null]
        .filter(Boolean)
        .join(" · ")
    : null

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] gap-4 pb-4"
      data-slot="album-part"
    >
      <div className="grid gap-1">
        <BackLink
          href={
            backToFolders
              ? href({ shelf: null, show: null })
              : `/staff/album${query(lens, null)}`
          }
        >
          {backToFolders ? eyebrow : PART_COPY.back}
        </BackLink>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h1 className="type-page-title text-ink">
            {open && allShelves.length > 1 ? open.label : part.label}
          </h1>
          <p className="text-meta text-ink-muted tabular-nums">
            {questions
              ? PART_COPY.questionsOf(head.empty, head.total)
              : PART_COPY.stillEmptyOf(head.empty, head.total)}
          </p>
        </div>
      </div>

      {folders && switched && part.types.length > 1 ? (
        <SegmentedControl
          label={`${part.label}: food or drinks`}
          value={type.category}
          onValueChange={(next) =>
            router.replace(href({ kind: next, show: null, shelf: null }), {
              scroll: false,
            })
          }
          options={part.types.map((t) => ({
            value: t.category,
            label: (
              <span className="inline-flex items-center gap-2">
                {t.label}
                <span className="text-caption tabular-nums opacity-80">
                  {t.empty}
                  <span className="sr-only"> empty</span>
                </span>
              </span>
            ),
          }))}
        />
      ) : null}

      {blocked ? <Notice tone="attention">{blocked}</Notice> : null}

      {part.total === 0 || (questions && places.length < 2) ? null : (
        <FilterRow
          withShow={!folders && !questions}
          posting={posting}
          show={show}
          defaultShow={defaultShow}
          lens={lens}
          places={places}
          showHref={(key) => href({ show: key })}
          placeHref={(id) => href({ lens: id })}
          clearHref={href({ lens: null, show: null })}
        />
      )}

      {folders ? (
        <ul className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))] lg:grid-cols-[repeat(4,minmax(0,1fr))]">
          {allShelves.map((shelf) => (
            <li key={shelf.key}>
              <ShelfFolder shelf={shelf} href={href({ shelf: shelf.key })} />
            </li>
          ))}
        </ul>
      ) : null}

      {questions ? <AmenityQuestions shelves={allShelves} /> : null}

      {!folders && !questions && sections.length > 1 ? (
        <nav
          aria-label="Jump to"
          className="sticky top-0 z-sticky -mx-page-gutter border-b border-line bg-canvas/95 px-page-gutter py-2 backdrop-blur"
        >
          <ul ref={barRef} className="flex gap-2 overflow-x-auto">
            {sections.map((section) => {
              const id = sectionAnchor(section.key)
              const here = inView === id
              return (
                <li key={section.key} className="shrink-0">
                  <a
                    href={`#${id}`}
                    aria-current={here ? "true" : undefined}
                    className={cn(
                      "flex min-h-12 items-center gap-1.5 rounded-round px-3 text-label focus-ring transition-colors duration-quick",
                      here
                        ? "bg-ink text-canvas"
                        : "bg-surface text-ink edge hover:bg-raised"
                    )}
                  >
                    {section.name}
                    <span className="text-caption tabular-nums opacity-80">
                      {section.empty}
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>
      ) : null}

      {!folders && !questions && sections.length === 0 && head.total > 0 ? (
        <p className="text-body text-ink-muted">{PART_COPY.noneShown}</p>
      ) : null}

      {!folders && !questions
        ? sections.map((section) => {
            const done = section.total > 0 && section.filled === section.total
            return (
              <section
                key={section.key}
                id={sectionAnchor(section.key)}
                aria-labelledby={`${sectionAnchor(section.key)}-title`}
                className="grid scroll-mt-20 gap-2"
              >
                {/* One section on a shelf (an amenity group, the venue's
                    areas) repeats the shelf's name: its heading is left out. */}
                <div
                  className={cn(
                    "flex items-center justify-between gap-3",
                    sections.length === 1 && "sr-only"
                  )}
                >
                  <h2
                    id={`${sectionAnchor(section.key)}-title`}
                    className="text-heading text-ink"
                  >
                    {section.name}
                  </h2>
                  {done ? (
                    <span className="inline-flex items-center gap-1 rounded-round bg-ok-bg px-2.5 py-1 text-caption font-semibold text-ok-fg">
                      <CheckIcon aria-hidden weight="bold" className="size-4" />
                      {PART_COPY.done}
                    </span>
                  ) : (
                    <span className="text-meta text-ink-muted tabular-nums">
                      {PART_COPY.sectionCount(section.filled, section.total)}
                    </span>
                  )}
                </div>
                <ul
                  className={cn(
                    "grid gap-x-2 gap-y-3",
                    // Rooms are wide: Spaces is two-up (screens-2 handoff).
                    part.key === "spaces"
                      ? "grid-cols-[repeat(2,minmax(0,1fr))] md:grid-cols-[repeat(3,minmax(0,1fr))] lg:grid-cols-[repeat(4,minmax(0,1fr))]"
                      : "grid-cols-[repeat(3,minmax(0,1fr))] md:grid-cols-[repeat(5,minmax(0,1fr))] lg:grid-cols-[repeat(6,minmax(0,1fr))]"
                  )}
                >
                  {section.shown.map((slot) => (
                    <li key={slot.id}>
                      <AlbumSlotTile slot={slot} add={add} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })
        : null}

      {/* Amenities are answered on each question's page, not added here. */}
      {questions ? null : (
        <ActionDock>
          <Button
            variant="primary"
            size="lg"
            className="min-h-14 w-full"
            disabled={!canAdd}
            onClick={() =>
              add({ match: { place: lens === "unplaced" ? null : lens } })
            }
          >
            <ImagesIcon data-icon="inline-start" aria-hidden />
            {PART_COPY.addMain}
          </Button>
        </ActionDock>
      )}
    </div>
  )
}

/**
 * Amenities as questions (screens-2 handoff): one RowList per amenity group,
 * its heading with how many are answered, each row the question, its answer
 * line and one progress chip. A row opens the question's page.
 */
function AmenityQuestions({ shelves }: { shelves: AlbumShelf[] }) {
  // No questions yet: say so with what happens next, not a blank page.
  if (shelves.every((shelf) => shelf.total === 0))
    return (
      <EmptyState
        title={PART_COPY.noQuestions}
        description={PART_COPY.noQuestionsText}
      />
    )
  return (
    <div className="grid gap-5" data-slot="album-questions">
      {shelves.map((shelf) => {
        const slots = shelf.sections.flatMap((s) => s.slots)
        const id = `questions-${sectionAnchor(shelf.key)}`
        return (
          <section key={shelf.key} aria-labelledby={id} className="grid gap-2">
            <SectionHeader
              id={id}
              title={shelf.label}
              action={
                <span className="text-meta text-ink-muted tabular-nums">
                  {PART_COPY.answeredOf(shelf.filled, shelf.total)}
                </span>
              }
            />
            <RowList list>
              {slots.map((slot) => (
                <Row
                  key={slot.id}
                  href={slotHref(slot)}
                  title={slot.name}
                  subtitle={questionLine(slot) ?? undefined}
                  chips={
                    slot.question ? (
                      <CheckProgressChip progress={slot.question.progress} />
                    ) : null
                  }
                />
              ))}
            </RowList>
          </section>
        )
      })}
    </div>
  )
}

/** The shelf nearest the top of the screen, for the jump bar's mark. */
function useShelfInView(ids: string[]): string | null {
  const [current, setCurrent] = React.useState<string | null>(ids[0] ?? null)
  const key = ids.join("|")
  React.useEffect(() => {
    const list = key ? key.split("|") : []
    const els = list
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)
    if (els.length === 0 || typeof IntersectionObserver === "undefined") return
    const seen = new Map<string, boolean>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting)
        const first = list.find((id) => seen.get(id))
        if (first) setCurrent(first)
      },
      { rootMargin: "-80px 0px -60% 0px" }
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [key])
  return current
}

/**
 * The part's filters in one row (§5d "A part" step 3): a Filter button with
 * the number of filters changed from the default, and a line saying what is
 * shown. The sheet (§5 Sheet) holds Show and Where are you?; each choice
 * applies at once, the screen behind updates, and Done closes it.
 */
function FilterRow({
  withShow,
  posting,
  show,
  defaultShow,
  lens,
  places,
  showHref,
  placeHref,
  clearHref,
}: {
  /** The folders have no Show: it applies to a shelf's slots. */
  withShow: boolean
  posting: boolean
  show: AlbumShow
  defaultShow: AlbumShow
  lens: PlaceLens
  places: LensPlace[]
  showHref: (key: AlbumShow) => string
  placeHref: (id: string | null) => string
  clearHref: string
}) {
  const [open, setOpen] = React.useState(false)
  const changed = (withShow && show !== defaultShow ? 1 : 0) + (lens ? 1 : 0)
  const shows = posting
    ? ALBUM_SHOWS.filter(({ key }) => key !== "waiting").map((option) =>
        option.key === "in-album" ? { ...option, label: "Posted" } : option
      )
    : ALBUM_SHOWS
  const showLabel = shows.find((s) => s.key === show)?.label ?? ""
  const placeLabel = lens
    ? (places.find((p) => p.id === lens)?.label ?? "")
    : LENS_COPY.allPlaces
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Button
        variant="secondary"
        className="min-h-12 shrink-0"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <FunnelSimpleIcon data-icon="inline-start" aria-hidden />
        {PART_COPY.filter}
        {changed > 0 ? (
          <span className="ml-1 rounded-round bg-ink px-1.5 text-caption text-canvas tabular-nums">
            {changed}
            <span className="sr-only"> changed</span>
          </span>
        ) : null}
      </Button>
      <p className="min-w-0 truncate text-meta text-ink-muted">
        {withShow ? `${showLabel} · ${placeLabel}` : placeLabel}
      </p>
      {changed > 0 ? (
        <Link
          href={clearHref}
          replace
          scroll={false}
          className="ml-auto inline-flex min-h-12 shrink-0 items-center text-label text-accent-text underline underline-offset-4 focus-ring"
        >
          {PART_COPY.clear}
        </Link>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{PART_COPY.filter}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-5">
            {withShow ? (
              <div className="grid gap-2">
                <h2 id="album-show" className="text-label text-ink-muted">
                  {PART_COPY.showTitle}
                </h2>
                <PillGroup aria-labelledby="album-show">
                  {shows.map(({ key, label }) => (
                    <FilterPill
                      key={key}
                      href={showHref(key)}
                      selected={key === show}
                      current="true"
                      scroll={false}
                      replace
                    >
                      {label}
                    </FilterPill>
                  ))}
                </PillGroup>
              </div>
            ) : null}
            <PlaceLensPills places={places} lens={lens} href={placeHref} wrap />
          </div>
          <DialogFooter>
            <Button className="min-h-12" onClick={() => setOpen(false)}>
              {PART_COPY.done}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * A shelf as a folder (§5d "A part" step 4): a 2×2 cover of its accepted
 * photos (empty frames where there are none yet), its name and how far it
 * is. The whole card opens the shelf.
 */
function ShelfFolder({ shelf, href }: { shelf: AlbumShelf; href: string }) {
  const covers = [...shelf.covers]
  const done = shelf.total > 0 && shelf.empty === 0
  return (
    <Link href={href} className="group grid gap-2 rounded-card focus-ring">
      {covers.length === 0 ? (
        // No photo yet: the folder reads as a gap to fill (§4 Needed frame).
        <span
          aria-hidden
          className="grid aspect-square place-content-center justify-items-center gap-1 rounded-card border-2 border-dashed border-edge-strong text-ink-muted"
        >
          <ImagesIcon className="size-8" />
          <span className="text-label tabular-nums">
            {PART_COPY.toAdd(shelf.empty)}
          </span>
        </span>
      ) : (
        <span
          aria-hidden
          className="grid aspect-square grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-card bg-surface-2 edge"
        >
          {[0, 1, 2, 3].map((i) =>
            covers[i] ? (
              <Photo
                key={i}
                alt=""
                ratio="1/1"
                radius="none"
                src={covers[i]}
                className="size-full"
              />
            ) : (
              <span key={i} className="bg-surface" />
            )
          )}
        </span>
      )}
      <span className="grid gap-0.5 px-0.5">
        <span className="flex items-center gap-1 text-label text-ink group-hover:underline">
          {shelf.label}
          {done ? (
            <CheckIcon
              aria-hidden
              weight="bold"
              className="size-4 text-ok-fg"
            />
          ) : null}
        </span>
        <span className="text-meta text-ink-muted tabular-nums">
          {PART_COPY.folderCount(shelf.filled, shelf.total, shelf.empty)}
        </span>
      </span>
    </Link>
  )
}
