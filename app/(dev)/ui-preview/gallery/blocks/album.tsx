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
  type MatchOutcome,
  type MatchPhoto,
  type SendState,
} from "@/components/nabalens/album/match/match-screen"
import type { BoardState } from "@/components/nabalens/album/match/match-picker"
import {
  AskedFor,
  askedForItems,
} from "@/components/nabalens/requests/staff-requests"
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

/** S2-REQ: two requests on Album Home, one on a slot and one New brief. */
const SAMPLE_SLOTS = new Map(
  SAMPLE.places
    .flatMap((p) => p.groups.flatMap((g) => g.slots))
    .map((slot) => [slot.id, slot])
)
const ASKED = askedForItems(
  [
    {
      id: "req-1",
      type: "missing_photo",
      slot: {
        kind: "area",
        slotId: GARDEN,
        name: "Garden",
        state: "missing",
      },
      subject: "Garden",
      brief: "From the gate, benches and the heaters in view",
      photoCount: 2,
      neededBy: "2026-11-30",
      orientation: "landscape",
      wantsVideo: false,
      captureWindow: "Before opening",
      referenceAssetId: null,
      forMe: true,
      state: "open",
    },
    {
      id: "req-2",
      type: "missing_photo",
      slot: null,
      subject: "Bonfire night table",
      brief: "A full table by the fire pit, lit",
      photoCount: 1,
      neededBy: null,
      orientation: null,
      wantsVideo: true,
      captureWindow: null,
      referenceAssetId: null,
      forMe: false,
      state: "open",
    },
  ],
  SAMPLE_SLOTS
)

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
        <h3 className="type-heading-sm text-ink">
          Album Home: Asked for (S2-REQ, spec §7 M4)
        </h3>
        <div className="max-w-feed rounded-card bg-canvas p-3 edge">
          <AskedFor items={ASKED} today="2026-11-18" canAdd headingLevel={4} />
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
  // S2-ADD: a slot with a photo already waiting, found by search ("chips").
  waiting: [
    {
      id: "dish:d",
      name: "Chunky chips",
      group: "Sides",
      place: PASS,
      placeLabel: "Kitchen pass",
      brief: null,
      target: { kind: "dish", itemId: "d", name: "Chunky chips" },
      aliases: ["fries"],
      waiting: true,
    },
  ],
  venue: { id: "v", name: "The Bell" },
}

/** Which Match the gallery opens (S2-ADD states). */
type MatchVariant = "live" | "loading" | "error" | "end"

export function MatchSpecimen() {
  const [variant, setVariant] = React.useState<MatchVariant | null>(null)
  const photos = React.useMemo<MatchPhoto[]>(
    () =>
      Array.from({ length: 10 }, (_, i) => ({
        key: `p${i}`,
        file: new File([new Uint8Array(8)], `photo-${i}.jpg`, {
          type: "image/jpeg",
        }),
      })),
    []
  )
  // Live: choices are kept here, so groups, I'm not sure and the end work.
  const [outcomes, setOutcomes] = React.useState<
    ReadonlyMap<string, MatchOutcome>
  >(new Map())
  const [states, setStates] = React.useState<ReadonlyMap<string, SendState>>(
    new Map()
  )
  const ended = React.useMemo(() => {
    const [guinness, pudding] = [MATCH_BOARD.slots[0], MATCH_BOARD.slots[2]]
    const end = new Map<string, MatchOutcome>()
    const sent = new Map<string, SendState>()
    photos.forEach((p, i) => {
      end.set(
        p.key,
        i < 4
          ? { kind: "slot", slot: guinness }
          : i < 7
            ? { kind: "slot", slot: pudding }
            : i < 9
              ? { kind: "unsure" }
              : { kind: "later" }
      )
      if (i < 7) sent.set(p.key, i === 6 ? "checking" : "waiting")
    })
    return { end, sent }
  }, [photos])
  const board: BoardState =
    variant === "loading"
      ? { state: "loading" }
      : variant === "error"
        ? { state: "error", message: "No signal." }
        : { state: "ready", board: MATCH_BOARD }
  const open = (next: MatchVariant) => {
    setOutcomes(new Map())
    setStates(new Map())
    setVariant(next)
  }
  return (
    <div className="grid gap-3">
      <h3 className="type-heading-sm text-ink">Match (§6.1)</h3>
      <p className="text-meta text-ink-muted">
        Ten photos at The Bell: same slot for the next photos, I&apos;m not
        sure, a note, recent and waiting slots (search &quot;fries&quot;), and
        the end with slot chips.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => open("live")}>Open Match with 10 photos</Button>
        <Button variant="secondary" onClick={() => open("loading")}>
          Loading
        </Button>
        <Button variant="secondary" onClick={() => open("error")}>
          Could not load
        </Button>
        <Button variant="secondary" onClick={() => open("end")}>
          The end
        </Button>
      </div>
      <MatchScreen
        open={variant !== null}
        photos={photos}
        outcomes={variant === "end" ? ended.end : outcomes}
        sendStates={variant === "end" ? ended.sent : states}
        board={board}
        onRetryBoard={() => setVariant("live")}
        current={BAR}
        last={null}
        venueName="The Bell"
        recent={["dish:c"]}
        duplicates={variant === "end" ? new Set(["p1"]) : undefined}
        onDecide={(key, outcome) => {
          setOutcomes((current) => new Map(current).set(key, outcome))
          if (outcome.kind === "slot")
            setStates((current) => new Map(current).set(key, "sending"))
        }}
        onSuggestSpecial={async () => ({ ok: true })}
        onClose={() => setVariant(null)}
      />
    </div>
  )
}
