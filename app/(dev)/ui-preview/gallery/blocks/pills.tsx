"use client"

import * as React from "react"
import {
  ImageIcon,
  ImagesIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react/dist/ssr"

import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"

/*
 * Gallery block for SegmentedControl, FilterPill and PillGroup (common-room.md
 * §4): every layout and state, with fake data only. Hover cannot be forced,
 * so it is not shown; focus is described in a note. A client file because
 * the controlled specimens hold their own state.
 */
const MEDIA = [
  { value: "all", label: "All" },
  { value: "photos", label: "Photos" },
  { value: "videos", label: "Videos" },
] as const

type Media = (typeof MEDIA)[number]["value"]

const MEDIA_ICONS = [
  { value: "all", label: "All", icon: <ImagesIcon /> },
  { value: "photos", label: "Photos", icon: <ImageIcon /> },
  { value: "videos", label: "Videos", icon: <VideoCameraIcon /> },
] as const

const LONG = [
  { value: "served", label: "Served every day the kitchen is open" },
  { value: "weekends", label: "Served at weekends and on bank holidays only" },
  { value: "never", label: "Not served here" },
] as const

const SECTIONS = ["Starters", "Mains", "Sides", "Desserts", "Drinks"] as const

const STATUSES = [
  { value: "all", label: "All", count: 48 },
  { value: "waiting", label: "Waiting", count: 12 },
  { value: "accepted", label: "Accepted", count: 31 },
  { value: "retake", label: "Retake asked", count: 5 },
] as const

function Specimen({
  caption,
  className,
  children,
}: {
  caption: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <figure className={`grid min-w-0 gap-1.5 ${className ?? ""}`}>
      {children}
      <figcaption className="text-meta text-ink-muted">{caption}</figcaption>
    </figure>
  )
}

function Group({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="grid gap-4">
      <h3 id={id} className="type-heading-sm text-ink">
        {title}
      </h3>
      {note ? <p className="text-body text-ink-muted">{note}</p> : null}
      {children}
    </section>
  )
}

// The width of a small phone, so the wrapping can be seen on a wide screen.
const PHONE = "w-full max-w-80"

export function PillsBlock() {
  const [media, setMedia] = React.useState<Media>("photos")
  const [sections, setSections] = React.useState<readonly string[]>(["Mains"])
  const [item, setItem] = React.useState(true)

  const toggleSection = (section: string) =>
    setSections((current) =>
      current.includes(section)
        ? current.filter((name) => name !== section)
        : [...current, section]
    )

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10">
      <Group
        id="gallery-segmented-layouts"
        title="Segmented control: layouts"
        note="One choice of a few. It is a radio group: Tab reaches the chosen segment, the arrow keys move and choose, and focus shows as a 3px ring 2px clear of the segment. Segments are 44px tall, the only size."
      >
        <Specimen caption="width full (the default): equal columns, uncontrolled">
          <SegmentedControl
            label="Media, full width"
            options={MEDIA}
            defaultValue="all"
          />
        </Specimen>
        <Specimen
          caption={`width fit, controlled: ${media} is chosen`}
          className="justify-items-start"
        >
          <SegmentedControl
            label="Media, fit"
            width="fit"
            options={MEDIA}
            value={media}
            onValueChange={setMedia}
          />
        </Specimen>
        <Specimen
          caption="with icons (decorative; the words carry the meaning)"
          className="justify-items-start"
        >
          <SegmentedControl
            label="Media, with icons"
            width="fit"
            options={MEDIA_ICONS}
            defaultValue="photos"
          />
        </Specimen>
        <Specimen caption="items passed as children">
          <SegmentedControl label="Appearance" defaultValue="system">
            <SegmentedControlItem value="system">System</SegmentedControlItem>
            <SegmentedControlItem value="light">Light</SegmentedControlItem>
            <SegmentedControlItem value="dark">Dark</SegmentedControlItem>
          </SegmentedControl>
        </Specimen>
        <Specimen caption="nothing chosen yet (a value that matches no segment)">
          <SegmentedControl<Media | "">
            label="Media, nothing chosen"
            options={MEDIA}
            value=""
          />
        </Specimen>
      </Group>

      <Group id="gallery-segmented-states" title="Segmented control: states">
        <Specimen caption="one segment switched off: label kept, a not-allowed mark, skipped by the arrow keys">
          <SegmentedControl
            label="Media, one off"
            defaultValue="all"
            options={[
              { value: "all", label: "All" },
              { value: "photos", label: "Photos" },
              { value: "videos", label: "Videos", disabled: true },
            ]}
          />
          <p className="text-meta text-ink-muted">
            Videos cannot be chosen: none have been sent yet.
          </p>
        </Specimen>
        <Specimen caption="whole control disabled">
          <SegmentedControl
            label="Media, disabled"
            options={MEDIA}
            defaultValue="photos"
            disabled
          />
        </Specimen>
        <Specimen caption="invalid, with its error">
          <SegmentedControl
            label="Media, invalid"
            options={MEDIA}
            aria-invalid
            aria-describedby="gallery-segmented-error"
          />
          <p id="gallery-segmented-error" className="text-meta text-warn-fg">
            Choose a media type before you carry on.
          </p>
        </Specimen>
        <Specimen caption="in a native form: sends media=photos">
          <form>
            <SegmentedControl
              name="media"
              label="Media, in a form"
              options={MEDIA}
              defaultValue="photos"
            />
          </form>
        </Specimen>
      </Group>

      <Group
        id="gallery-segmented-phone"
        title="Segmented control: long labels and the phone layout"
        note="Shown at 320px. Labels wrap inside their segment. Where they are too long to sit side by side, stack them: always, or on phones only."
      >
        <Specimen caption="width full at 320px: labels wrap" className={PHONE}>
          <SegmentedControl
            label="Media, narrow"
            defaultValue="both"
            options={[
              { value: "both", label: "Photos and videos" },
              { value: "photos", label: "Photos only" },
              { value: "videos", label: "Videos only" },
            ]}
          />
        </Specimen>
        <Specimen
          caption="stack always: one column, card radius track, control radius segments"
          className={PHONE}
        >
          <SegmentedControl
            label="When it is served"
            stack="always"
            options={LONG}
            defaultValue="served"
          />
        </Specimen>
        <Specimen caption="stack phone: one column below 768px, a row above it">
          <SegmentedControl
            label="When it is served, stacked on phones"
            stack="phone"
            options={LONG}
            defaultValue="weekends"
          />
        </Specimen>
      </Group>

      <Group
        id="gallery-pill-toggle"
        title="Filter pill: toggle mode"
        note="A button with aria-pressed, for filters kept on the page. A pill that is on has a tick as well as its colour. Focus shows as a 3px ring 2px clear of the pill. Pills are 44px tall, the only size."
      >
        <Specimen caption="off">
          <PillGroup label="Off example">
            <FilterPill>Mains</FilterPill>
          </PillGroup>
        </Specimen>
        <Specimen caption="on (aria-pressed true): accent-soft, selected edge, tick">
          <PillGroup label="On example">
            <FilterPill selected>Mains</FilterPill>
          </PillGroup>
        </Specimen>
        <Specimen
          caption={`several may be on; press to switch: ${
            sections.length > 0 ? sections.join(", ") : "none"
          }`}
        >
          <PillGroup label="Sections">
            {SECTIONS.map((section) => (
              <FilterPill
                key={section}
                selected={sections.includes(section)}
                onClick={() => toggleSection(section)}
              >
                {section}
              </FilterPill>
            ))}
          </PillGroup>
        </Specimen>
        <Specimen caption="with a count (mono)">
          <PillGroup label="Status, with counts">
            {STATUSES.map((status) => (
              <FilterPill
                key={status.value}
                selected={status.value === "waiting"}
                count={status.count}
              >
                {status.label}
              </FilterPill>
            ))}
          </PillGroup>
        </Specimen>
      </Group>

      <Group
        id="gallery-pill-link"
        title="Filter pill: link mode"
        note="A link, for filters kept in the URL. The one that is on carries aria-current: page by default, or true for one of a set that is not a page."
      >
        <Specimen caption='aria-current="page" on Mains'>
          <PillGroup label="Menu section">
            {SECTIONS.map((section) => (
              <FilterPill
                key={section}
                href={`#section-${section.toLowerCase()}`}
                selected={section === "Mains"}
              >
                {section}
              </FilterPill>
            ))}
          </PillGroup>
        </Specimen>
        <Specimen caption='current="true" on Newest first, with a visible group label'>
          <span id="gallery-pill-sort" className="text-label text-ink">
            Sort
          </span>
          <PillGroup aria-labelledby="gallery-pill-sort">
            <FilterPill href="#sort-newest" selected current="true">
              Newest first
            </FilterPill>
            <FilterPill href="#sort-oldest">Oldest first</FilterPill>
            <FilterPill href="#sort-name">By name</FilterPill>
          </PillGroup>
        </Specimen>
      </Group>

      <Group
        id="gallery-pill-states"
        title="Filter pill: removable and blocked"
      >
        <Specimen
          caption={
            item
              ? "removable: a filter that is on, with a cross; its name starts with Remove filter:"
              : "removed; press Put it back to see it again"
          }
        >
          <PillGroup label="Showing one item">
            {item ? (
              <FilterPill removable onClick={() => setItem(false)}>
                Showing lamb bhuna
              </FilterPill>
            ) : (
              <FilterPill onClick={() => setItem(true)}>Put it back</FilterPill>
            )}
          </PillGroup>
        </Specimen>
        <Specimen caption="removable in link mode">
          <PillGroup label="Showing one person">
            <FilterPill href="#all-staff" removable>
              Photos by Asha
            </FilterPill>
          </PillGroup>
        </Specimen>
        <Specimen caption="blocked with a reason (aria-disabled): still focusable, does nothing, and the reason is read out and shown">
          <PillGroup label="Media, one blocked">
            <FilterPill selected>Photos</FilterPill>
            <FilterPill disabledReason="No videos have been sent yet.">
              Videos
            </FilterPill>
            <FilterPill
              href="#drinks"
              disabledReason="No videos have been sent yet."
            >
              Videos (link mode)
            </FilterPill>
          </PillGroup>
          <p className="text-meta text-ink-muted">
            No videos have been sent yet.
          </p>
        </Specimen>
        <Specimen caption="blocked while on: keeps its tick and edge">
          <PillGroup label="Blocked while on">
            <FilterPill
              selected
              disabledReason="Filters are locked while photos send."
            >
              Mains
            </FilterPill>
          </PillGroup>
          <p className="text-meta text-ink-muted">
            Filters are locked while photos send.
          </p>
        </Specimen>
        <Specimen caption="native disabled: out of the focus order, so use it only where no reason is needed">
          <PillGroup label="Native disabled">
            <FilterPill disabled>Desserts</FilterPill>
          </PillGroup>
        </Specimen>
      </Group>

      <Group
        id="gallery-pill-phone"
        title="Pill group: wrapping and long labels"
        note="Shown at 320px. The row wraps onto new lines and a long label wraps inside its pill; nothing scrolls sideways."
      >
        <Specimen caption="many pills at 320px" className={PHONE}>
          <PillGroup label="Sections, narrow">
            {SECTIONS.map((section) => (
              <FilterPill
                key={section}
                selected={section === "Sides"}
                count={7}
              >
                {section}
              </FilterPill>
            ))}
          </PillGroup>
        </Specimen>
        <Specimen caption="a long label at 320px" className={PHONE}>
          <PillGroup label="Long labels">
            <FilterPill selected count={3}>
              Vegetarian and vegan dishes with no photo yet
            </FilterPill>
            <FilterPill removable>
              Showing chargrilled lamb chops with mint yoghurt
            </FilterPill>
          </PillGroup>
        </Specimen>
      </Group>
    </div>
  )
}
