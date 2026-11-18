"use client"

import { AlbumHome } from "@/components/nabalens/album/album-home"
import { AlbumPlaceScreen } from "@/components/nabalens/album/album-place"
import {
  AlbumPlacesForm,
  type AlbumPlacesGroup,
} from "@/components/nabalens/album/album-places-form"
import { SlotTile, type SlotState } from "@/components/nabalens/album/slot-tile"
import type { MatchBoard } from "@/components/nabalens/album/match/model"
import {
  MatchScreen,
  type MatchPhoto,
} from "@/components/nabalens/album/match/match-screen"
import { Button } from "@/components/ui/button"
import * as React from "react"
import { buildAlbum, currentPlace, type AlbumInput } from "@/lib/album/model"

import { StaffMeSpecimens } from "../staff-me-specimens"

/*
 * Gallery block for the Album components (DESIGN.md §5). A1: the slot tile.
 * A2: Album Home, a place, and the manager's Album places, on made-up data.
 * Later batches add the match picker here. Names are made up; tiles with a photo show the placeholder
 * fill, since the gallery has no photos of its own.
 */

const STATES: Array<{
  state: SlotState
  name: string
  progress?: number
  offline?: boolean
  caption: string
}> = [
  {
    state: "needed",
    name: "Guinness, pint",
    caption: "Needed: dashed edge, + Add. Opens the gallery.",
  },
  {
    state: "sending",
    name: "Espresso martini",
    progress: 40,
    caption: "Sending, with progress.",
  },
  {
    state: "sending",
    name: "Cider, half",
    offline: true,
    caption: "Sending while offline: held on the phone.",
  },
  {
    state: "waiting",
    name: "House red",
    caption: "Waiting for review: oat ring.",
  },
  {
    state: "retake",
    name: "Board games",
    caption: "Needs another photo: rust ring.",
  },
  {
    state: "accepted",
    name: "Aperol spritz",
    caption: "Accepted: green square mark.",
  },
  {
    state: "not-here",
    name: "Hot chocolate",
    caption: "Not here: dotted edge over hatching.",
  },
]

export function AlbumBlock() {
  return (
    <div className="grid gap-8">
      <AlbumScreensBlock />
      {/* S2-STAFF: filters, the slot page, My uploads and Help and account. */}
      <StaffMeSpecimens album={SAMPLE} barId={BAR} />
      <MatchSpecimen />
      <div className="grid gap-4">
        <h3 className="type-heading-sm text-ink">Slot tile</h3>
        <ul className="grid max-w-feed grid-cols-3 gap-2 sm:grid-cols-4">
          {STATES.map((item) => (
            <li
              key={`${item.state}-${item.name}`}
              className="grid content-start gap-1.5"
            >
              <SlotTile
                name={item.name}
                state={item.state}
                progress={item.progress}
                offline={item.offline}
                href={item.state === "needed" ? "#album" : undefined}
              />
              <p className="text-meta text-ink-muted">{item.caption}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ---- A2: Album Home and a place, on made-up data ---- */

const BAR = "00000000-0000-4000-8000-00000000b001"
const PASS = "00000000-0000-4000-8000-00000000b002"
const GARDEN = "00000000-0000-4000-8000-00000000b003"

const dish = (
  n: number,
  name: string,
  sectionId: string,
  sectionName: string,
  over: Partial<AlbumInput["dishes"][number]> = {}
): AlbumInput["dishes"][number] => ({
  itemId: `00000000-0000-4000-8000-0000000d00${String(n).padStart(2, "0")}`,
  name,
  sectionId,
  sectionName,
  covered: false,
  needsRecheck: false,
  thumbnailUrl: null,
  myWaiting: 0,
  reviewState: null,
  neededBy: null,
  ...over,
})

const DRINKS = "00000000-0000-4000-8000-00000000c001"
const DESSERTS = "00000000-0000-4000-8000-00000000c002"

const SAMPLE = buildAlbum({
  places: [
    { subjectId: BAR, label: "The bar" },
    { subjectId: PASS, label: "Kitchen pass" },
    { subjectId: GARDEN, label: "Garden" },
  ],
  placements: [
    { source: "menu_section", key: "drinks", subjectId: BAR },
    { source: "menu_section", key: "desserts", subjectId: PASS },
    { source: "amenity_category", key: "Games", subjectId: BAR },
  ],
  sections: [
    { sectionId: DRINKS, slug: "drinks" },
    { sectionId: DESSERTS, slug: "desserts" },
  ],
  dishes: [
    dish(1, "Guinness, pint", DRINKS, "Drinks"),
    dish(2, "Espresso martini", DRINKS, "Drinks", {
      neededBy: { date: "2026-11-30", passed: false },
    }),
    dish(3, "Aperol spritz", DRINKS, "Drinks", { covered: true }),
    dish(4, "House red", DRINKS, "Drinks", { myWaiting: 1 }),
    dish(5, "Sticky toffee pudding", DESSERTS, "Desserts"),
    dish(6, "Eton mess", DESSERTS, "Desserts", { covered: true }),
  ],
  amenities: [
    {
      checkId: "00000000-0000-4000-8000-0000000a0001",
      question: "Can guests play darts?",
      category: "Games",
      progress: "needs_capture",
      answer: null,
      myLatestState: null,
    },
    {
      checkId: "00000000-0000-4000-8000-0000000a0002",
      question: "Is there a fruit machine?",
      category: "Games",
      progress: "complete",
      answer: "no",
      myLatestState: null,
    },
  ],
  areas: [
    { subjectId: BAR, label: "The bar", state: "accepted" },
    { subjectId: GARDEN, label: "Garden", state: "needed" },
  ],
  myRetakeItemIds: new Set(["00000000-0000-4000-8000-0000000d0001"]),
})

const PLACES_GROUPS: AlbumPlacesGroup[] = [
  { source: "menu_section", key: "drinks", name: "Drinks", subjectId: BAR },
  {
    source: "menu_section",
    key: "desserts",
    name: "Desserts",
    subjectId: PASS,
  },
  { source: "amenity_category", key: "Games", name: "Games", subjectId: BAR },
  {
    source: "amenity_category",
    key: "Accessibility",
    name: "Accessibility",
    subjectId: null,
  },
]

export function AlbumScreensBlock() {
  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <h3 className="type-heading-sm text-ink">Album Home (§5a)</h3>
        <div className="max-w-feed rounded-card bg-canvas p-3 edge">
          <AlbumHome
            venueName="The Bell"
            album={SAMPLE}
            current={currentPlace(SAMPLE, null)}
            retakes={[
              {
                itemId: "00000000-0000-4000-8000-0000000d0001",
                itemName: "Guinness, pint",
                reason: "Show the glass side on",
              },
            ]}
            canAdd
            blocked={null}
            headingLevel={4}
          />
        </div>
      </div>
      <div className="grid gap-3">
        <h3 className="type-heading-sm text-ink">A place (§6.2)</h3>
        <div className="max-w-feed rounded-card bg-canvas p-3 edge">
          <AlbumPlaceScreen
            venueName="The Bell"
            place={currentPlace(SAMPLE, BAR)!}
            canAdd
            headingLevel={4}
          />
        </div>
      </div>
      <div className="grid gap-3">
        <h3 className="type-heading-sm text-ink">Album places (manager)</h3>
        <div className="max-w-reading">
          <AlbumPlacesForm
            places={[
              { subjectId: BAR, label: "The bar" },
              { subjectId: PASS, label: "Kitchen pass" },
              { subjectId: GARDEN, label: "Garden" },
            ]}
            groups={PLACES_GROUPS}
            onSet={async () => ({ ok: true })}
          />
        </div>
      </div>
    </div>
  )
}

/* ---- A3: Match, on made-up photos (opens as a dialog) ---- */

const MATCH_BOARD: MatchBoard = {
  slots: [
    {
      id: "dish:a",
      name: "Guinness, pint",
      group: "Drinks",
      place: BAR,
      placeLabel: "The bar",
      brief: "Side on at the counter, glass fills the frame",
      target: { kind: "dish", itemId: "a", name: "Guinness, pint" },
    },
    {
      id: "dish:b",
      name: "Espresso martini",
      group: "Drinks",
      place: BAR,
      placeLabel: "The bar",
      brief: null,
      target: { kind: "dish", itemId: "b", name: "Espresso martini" },
    },
    {
      id: "dish:c",
      name: "Sticky toffee pudding",
      group: "Desserts",
      place: PASS,
      placeLabel: "Kitchen pass",
      brief: "Side on, sauce pouring, on the slate plate",
      target: { kind: "dish", itemId: "c", name: "Sticky toffee pudding" },
    },
    {
      id: `area:${GARDEN}`,
      name: "Garden",
      group: "The space",
      place: GARDEN,
      placeLabel: "Garden",
      brief: null,
      target: { kind: "area", subjectId: GARDEN, name: "Garden" },
    },
  ],
  amenities: ["Can guests play darts?"],
}

export function MatchSpecimen() {
  const [open, setOpen] = React.useState(false)
  const photos = React.useMemo<MatchPhoto[]>(
    () =>
      Array.from({ length: 20 }, (_, i) => ({
        key: `p${i}`,
        file: new File([new Uint8Array(8)], `photo-${i}.jpg`, {
          type: "image/jpeg",
        }),
      })),
    []
  )
  return (
    <div className="grid gap-3">
      <h3 className="type-heading-sm text-ink">Match (§6.1)</h3>
      <div>
        <Button onClick={() => setOpen(true)}>Open Match with 20 photos</Button>
      </div>
      <MatchScreen
        open={open}
        photos={photos}
        outcomes={new Map()}
        sendStates={new Map()}
        board={{ state: "ready", board: MATCH_BOARD }}
        onRetryBoard={() => {}}
        current={BAR}
        last={null}
        onDecide={() => {}}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}
