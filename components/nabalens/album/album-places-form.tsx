"use client"

import * as React from "react"

import { Notice } from "@/components/nabalens/notice"
import { fieldControlVariants } from "@/components/ui/field-control"

/*
 * Album A2 (DESIGN.md §6.2): where staff photograph each menu section and
 * amenity category. One native select per group, saved as soon as it
 * changes; the result is written on the page beside the group (§6.7). A
 * native select works with every keyboard and screen reader and needs no
 * popup of our own.
 */

export type AlbumPlacesGroup = {
  source: "menu_section" | "amenity_category"
  /** The section slug or the category name. */
  key: string
  /** What managers call it: "Desserts", "Games". */
  name: string
  subjectId: string | null
}

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
}: {
  places: Array<{ subjectId: string; label: string }>
  groups: AlbumPlacesGroup[]
  onSet: AlbumPlacesSetter
}) {
  const menu = groups.filter((g) => g.source === "menu_section")
  const amenities = groups.filter((g) => g.source === "amenity_category")
  return (
    <div className="grid gap-8">
      <GroupList
        title="Menu sections"
        empty="No active menu yet. Sections appear here once a menu is active."
        groups={menu}
        places={places}
        onSet={onSet}
      />
      <GroupList
        title="Amenities"
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
  empty,
  groups,
  places,
  onSet,
}: {
  title: string
  empty: string
  groups: AlbumPlacesGroup[]
  places: Array<{ subjectId: string; label: string }>
  onSet: AlbumPlacesSetter
}) {
  return (
    <section className="grid gap-3" aria-labelledby={`album-${title}`}>
      <h2 id={`album-${title}`} className="type-section-title text-ink">
        {title}
      </h2>
      {groups.length === 0 ? (
        <p className="text-body text-ink-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line rounded-card bg-surface shadow-card">
          {groups.map((group) => (
            <GroupRow
              key={`${group.source}:${group.key}`}
              group={group}
              places={places}
              onSet={onSet}
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
}: {
  group: AlbumPlacesGroup
  places: Array<{ subjectId: string; label: string }>
  onSet: AlbumPlacesSetter
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

  return (
    <li className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-center">
      <label htmlFor={id} className="text-label text-ink">
        {group.name}
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
    </li>
  )
}
