"use client"

import * as React from "react"

import { Notice } from "@/components/nabalens/notice"
import {
  SLOT_BRIEF_COPY,
  SlotBriefField,
  type SlotBriefSaver,
} from "@/components/nabalens/album/slot-brief-field"
import { BRIEF_MAX } from "@/lib/album/model"
import { fieldControlVariants } from "@/components/ui/field-control"

/*
 * Album A2 (DESIGN.md §6.2): where staff photograph each menu section and
 * amenity category. One native select per group, saved as soon as it
 * changes; the result is written on the page beside the group (§6.7). A
 * native select works with every keyboard and screen reader and needs no
 * popup of our own. Album AL-4 (§5 Brief): each menu section also has its
 * one-line brief, which every dish in it uses unless the dish has its own.
 * Briefs do not depend on places: with no places listed yet, each group says
 * "Not placed" and the section briefs can still be written. Second handoff:
 * one row per section (its place, its shelf, its brief with Save brief),
 * the count in each heading; amenities below with a place only.
 */

/** One row: the name, then place, shelf and brief side by side on a wide
 * screen; two by two from 768px; stacked on a phone. */
const ROW =
  "grid gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-2 lg:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)] lg:items-start"

export type AlbumPlacesGroup = {
  source: "menu_section" | "amenity_category"
  /** The section slug or the category name. */
  key: string
  /** What managers call it: "Desserts", "Games". */
  name: string
  subjectId: string | null
  /** A menu section's brief (AL-4); amenity categories have none here. */
  brief?: string | null
  /**
   * A menu section's shelf in Album (DESIGN.md §5d): its type's shelves, the
   * one its name suggests and the manager's own choice, if any.
   */
  shelf?: {
    options: Array<{ key: string; label: string }>
    suggested: string
    chosen: string | null
  }
}

/** Puts a section on a shelf, or clears the choice (null) (§5d, D16). */
export type AlbumShelfSetter = (input: {
  key: string
  shelf: string | null
}) => Promise<{ ok: true } | { ok: false; message: string }>

export const SECTION_BRIEF_HINT = `One line on what each photo in this section must show, up to ${BRIEF_MAX} characters. A dish's own brief, set on its menu page, comes first.`

/** Sets or clears a menu section's brief (AL-4). */
export type AlbumBriefSetter = (input: {
  source: "menu_section"
  key: string
  brief: string | null
}) => Promise<
  { ok: true; brief: string | null } | { ok: false; message: string }
>

export type AlbumPlacesSetter = (input: {
  source: AlbumPlacesGroup["source"]
  key: string
  subjectId: string | null
}) => Promise<{ ok: true } | { ok: false; message: string }>

type RowStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; place: string | null }
  | { kind: "failed"; message: string }

export function AlbumPlacesForm({
  places,
  groups,
  onSet,
  onSetBrief,
  onSetShelf,
}: {
  places: Array<{ subjectId: string; label: string }>
  groups: AlbumPlacesGroup[]
  onSet: AlbumPlacesSetter
  /** When given, each menu section gets a brief field (AL-4). */
  onSetBrief?: AlbumBriefSetter
  /**
   * When given, each menu section's shelf can be changed (§5d); without it
   * the shelf is shown but not offered (shelves not installed yet).
   */
  onSetShelf?: AlbumShelfSetter
}) {
  const menu = groups.filter((g) => g.source === "menu_section")
  const amenities = groups.filter((g) => g.source === "amenity_category")
  return (
    <div className="grid gap-8">
      <GroupList
        title="Menu sections"
        empty="No active menu yet. Sections appear here once a menu is active."
        intro={onSetBrief ? SECTION_BRIEF_HINT : undefined}
        groups={menu}
        places={places}
        onSet={onSet}
        onSetBrief={onSetBrief}
        onSetShelf={onSetShelf}
      />
      <GroupList
        title="Amenities"
        intro="Where each group is photographed."
        empty="No amenity checks at this venue yet."
        groups={amenities}
        places={places}
        onSet={onSet}
      />
    </div>
  )
}

function GroupList({
  title,
  intro,
  empty,
  groups,
  places,
  onSet,
  onSetBrief,
  onSetShelf,
}: {
  title: string
  intro?: string
  empty: string
  groups: AlbumPlacesGroup[]
  places: Array<{ subjectId: string; label: string }>
  onSet: AlbumPlacesSetter
  onSetBrief?: AlbumBriefSetter
  onSetShelf?: AlbumShelfSetter
}) {
  return (
    <section className="grid gap-3" aria-labelledby={`album-${title}`}>
      <div className="grid gap-1 px-1">
        <h2
          id={`album-${title}`}
          className="flex flex-wrap items-baseline gap-x-3 type-section-title text-ink"
        >
          {title}
          {groups.length > 0 ? (
            <span className="text-meta font-normal text-ink-muted tabular-nums">
              {groups.length}
            </span>
          ) : null}
        </h2>
        {intro && groups.length > 0 ? (
          <p className="text-meta text-ink-muted">{intro}</p>
        ) : null}
      </div>
      {groups.length === 0 ? (
        <p className="text-body text-ink-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card bg-surface edge">
          {groups.map((group) => (
            <GroupRow
              key={`${group.source}:${group.key}`}
              group={group}
              places={places}
              onSet={onSet}
              onSetBrief={onSetBrief}
              onSetShelf={onSetShelf}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function GroupRow({
  group,
  places,
  onSet,
  onSetBrief,
  onSetShelf,
}: {
  group: AlbumPlacesGroup
  places: Array<{ subjectId: string; label: string }>
  onSet: AlbumPlacesSetter
  onSetBrief?: AlbumBriefSetter
  onSetShelf?: AlbumShelfSetter
}) {
  const id = React.useId()
  const [value, setValue] = React.useState(group.subjectId ?? "")
  const [status, setStatus] = React.useState<RowStatus>({ kind: "idle" })

  async function change(next: string) {
    const previous = value
    setValue(next)
    setStatus({ kind: "saving" })
    const result = await onSet({
      source: group.source,
      key: group.key,
      subjectId: next || null,
    })
    if (result.ok) {
      const place = places.find((p) => p.subjectId === next)?.label
      setStatus({ kind: "saved", place: place ?? null })
    } else {
      // Keep what was there before; say why.
      setValue(previous)
      setStatus({ kind: "failed", message: result.message })
    }
  }

  const brief =
    onSetBrief && group.source === "menu_section" ? (
      <div className="min-w-0 md:col-span-2 lg:col-span-1">
        <SlotBriefField
          compact
          name={group.name}
          brief={group.brief ?? null}
          label={SLOT_BRIEF_COPY.labelFor(group.name)}
          hint={SECTION_BRIEF_HINT}
          onSave={
            ((brief) =>
              onSetBrief({
                source: "menu_section",
                key: group.key,
                brief,
              })) satisfies SlotBriefSaver
          }
        />
      </div>
    ) : null

  const shelf = group.shelf ? (
    <div className="min-w-0">
      <ShelfField
        name={group.name}
        sectionKey={group.key}
        shelf={group.shelf}
        onSet={onSetShelf}
      />
    </div>
  ) : brief ? (
    // Keeps the brief in its own column on a wide screen.
    <div aria-hidden className="hidden lg:block" />
  ) : null

  // No places to choose from yet: the group is not placed, nothing to pick.
  if (places.length === 0)
    return (
      <li className={ROW}>
        <p className="text-label text-ink md:col-span-2 lg:col-span-1 lg:pt-3">
          {group.name}
        </p>
        <p className="text-meta text-ink-muted lg:pt-3.5">Not placed</p>
        {shelf}
        {brief}
      </li>
    )

  return (
    <li className={ROW}>
      <label
        htmlFor={id}
        className="text-label text-ink md:col-span-2 lg:col-span-1 lg:pt-3"
      >
        {group.name}
      </label>
      <div className="grid min-w-0 gap-1.5">
        <select
          id={id}
          value={value}
          disabled={status.kind === "saving"}
          onChange={(event) => void change(event.target.value)}
          className={fieldControlVariants({ size: "md" })}
          aria-describedby={`${id}-status`}
        >
          <option value="">Not placed</option>
          {places.map((place) => (
            <option key={place.subjectId} value={place.subjectId}>
              {place.label}
            </option>
          ))}
        </select>
        <div id={`${id}-status`} role="status" aria-live="polite">
          {status.kind === "saving" ? (
            <p className="text-meta text-ink-muted">Saving…</p>
          ) : status.kind === "saved" ? (
            <p className="text-meta text-ink-muted">
              {status.place
                ? `Saved: ${group.name} is photographed at ${status.place}.`
                : `Saved: ${group.name} is not placed.`}
            </p>
          ) : status.kind === "failed" ? (
            <Notice tone="negative" role="none">
              {status.message}
            </Notice>
          ) : null}
        </div>
      </div>
      {shelf}
      {brief}
    </li>
  )
}

/**
 * A section's shelf in Album (DESIGN.md §5d): "Suggested" follows the
 * section's name; another choice is the manager's and always wins. Saved as
 * soon as it changes, with the result written beside it (§6.7).
 */
function ShelfField({
  name,
  sectionKey,
  shelf,
  onSet,
}: {
  name: string
  sectionKey: string
  shelf: NonNullable<AlbumPlacesGroup["shelf"]>
  onSet?: AlbumShelfSetter
}) {
  const id = React.useId()
  const [value, setValue] = React.useState(shelf.chosen ?? "")
  const [status, setStatus] = React.useState<RowStatus>({ kind: "idle" })
  const label = (key: string) =>
    shelf.options.find((o) => o.key === key)?.label ?? key
  const suggested = label(shelf.suggested)

  if (!onSet)
    return (
      <p className="text-meta text-ink-muted lg:pt-3.5">
        Shelf in Album: {label(shelf.chosen ?? shelf.suggested)}
        {shelf.chosen ? "" : " (suggested)"}
      </p>
    )

  async function change(next: string) {
    const previous = value
    setValue(next)
    setStatus({ kind: "saving" })
    const result = await onSet!({ key: sectionKey, shelf: next || null })
    if (result.ok)
      setStatus({ kind: "saved", place: next ? label(next) : null })
    else {
      setValue(previous)
      setStatus({ kind: "failed", message: result.message })
    }
  }

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="sr-only">
        Shelf in Album
      </label>
      <div className="grid gap-1.5">
        <select
          id={id}
          value={value}
          disabled={status.kind === "saving"}
          onChange={(event) => void change(event.target.value)}
          className={fieldControlVariants({ size: "md" })}
          aria-describedby={`${id}-status`}
        >
          <option value="">Suggested: {suggested}</option>
          {shelf.options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <div id={`${id}-status`} role="status" aria-live="polite">
          {status.kind === "saving" ? (
            <p className="text-meta text-ink-muted">Saving…</p>
          ) : status.kind === "saved" ? (
            <p className="text-meta text-ink-muted">
              {status.place
                ? `Saved: ${name} is on ${status.place}.`
                : `Saved: ${name} follows the suggestion, ${suggested}.`}
            </p>
          ) : status.kind === "failed" ? (
            <Notice tone="negative" role="none">
              {status.message}
            </Notice>
          ) : null}
        </div>
      </div>
    </div>
  )
}
