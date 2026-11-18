// @vitest-environment jsdom
// Full App v1 S2-ADD (spec §5.1-§5.5, §6 S1-S2; FA-3, FA-4): adding and
// labelling with Match. The venue is always named; "Same slot for the next
// photos too?" takes a run of one dish in one tap; I'm not sure sends the
// photo to the manager (Needs label) with an optional note; recent and
// waiting slots and other names are offered; dark, blurred and small photos
// get a hint that never blocks; a venue change undoes unsent choices (AC11);
// the end names the venue, the counts and the slots. Taps are counted for
// the two journeys the delivery measures.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { trackFlow } from "@/lib/metrics/track"
import { AddHost } from "@/app/staff/_shell/add-host"
import type { MatchBoard } from "@/components/nabalens/album/match/model"
import {
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import type { Uploader } from "@/components/nabalens/upload-queue"

import { CATALOGUE, savedAnswer } from "./labels-fixtures"

const PASS = "00000000-0000-4000-8000-00000000b002"
const GARDEN = "00000000-0000-4000-8000-00000000b003"
const BAR = "00000000-0000-4000-8000-00000000b001"

const BOARD: MatchBoard = {
  slots: [
    {
      id: "dish:item-lassi",
      name: "Mango Lassi",
      group: "Drinks",
      place: BAR,
      placeLabel: "The bar",
      brief: null,
      target: { kind: "dish", itemId: "item-lassi", name: "Mango Lassi" },
    },
    {
      id: "dish:item-bhaji",
      name: "Onion Bhaji",
      group: "Starters",
      place: PASS,
      placeLabel: "Kitchen pass",
      brief: "The whole plate, from above",
      target: { kind: "dish", itemId: "item-bhaji", name: "Onion Bhaji" },
      aliases: ["pakora"],
    },
    {
      id: "dish:item-tikka",
      name: "Chicken Tikka",
      group: "Starters",
      place: PASS,
      placeLabel: "Kitchen pass",
      brief: null,
      target: { kind: "dish", itemId: "item-tikka", name: "Chicken Tikka" },
    },
    {
      id: `area:${GARDEN}`,
      name: "The garden",
      group: "The space",
      place: GARDEN,
      placeLabel: "The garden",
      brief: null,
      target: { kind: "area", subjectId: GARDEN, name: "The garden" },
    },
  ],
  amenities: ["Is there a darts board?"],
  waiting: [
    {
      id: "dish:item-korma-chicken",
      name: "Garlic Naan",
      group: "Sides",
      place: PASS,
      placeLabel: "Kitchen pass",
      brief: null,
      target: {
        kind: "dish",
        itemId: "item-korma-chicken",
        name: "Garlic Naan",
      },
      waiting: true,
    },
  ],
  venue: { id: "venue-1", name: "The Bell" },
}

const { supabase, uploads, actions, match, area, quality } = vi.hoisted(() => ({
  quality: {
    hints: null as null | {
      width: number
      height: number
      brightness: number
      sharpness: number
    },
  },
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: "u1" } } },
        error: null,
      })),
    },
  },
  uploads: { current: null as Uploader | null },
  actions: {
    loadLabelEditorContext: vi.fn(),
    loadLabelCatalogue: vi.fn(),
    saveLabelBatch: vi.fn(),
  },
  match: {
    loadMatchBoardAction: vi.fn(),
    requestLabelHelpAction: vi.fn(),
    suggestSpecialAction: vi.fn(),
  },
  area: {
    setAreaLabelAction: vi.fn(),
    loadAreaLabelsAction: vi.fn(),
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => supabase }))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => uploads.current,
}))
vi.mock("@/app/_labels/actions", () => actions)
vi.mock("@/app/staff/_shell/match-actions", () => match)
vi.mock("@/app/_labels/area-actions", () => area)

vi.mock("@/lib/metrics/track", async (original) => ({
  ...(await original<typeof import("@/lib/metrics/track")>()),
  trackFlow: vi.fn(),
}))

vi.mock("@/lib/upload/quality", async (original) => ({
  ...(await original<typeof import("@/lib/upload/quality")>()),
  measurePhoto: vi.fn(async () => quality.hints),
}))

const jpeg = (name: string, lastModified = 0) =>
  new File([new Uint8Array(64)], name, { type: "image/jpeg", lastModified })

/** The label API: the menu, and each label send. */
let posted: { venueId: string; input: Record<string, unknown> }[] = []
function labelApi(url: string, init?: RequestInit) {
  const method = init?.method ?? "GET"
  let body: unknown
  if (method === "POST") {
    const sent = JSON.parse(String(init!.body))
    posted.push(sent)
    body = savedAnswer(sent)
  } else if (method === "DELETE") body = { ok: true }
  else if (url.includes("attention=1")) body = { ok: true, items: [] }
  else body = { ok: true, catalogue: CATALOGUE, focus: null }
  return Promise.resolve({ json: async () => body } as Response)
}

let started: string[] = []
beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  posted = []
  started = []
  uploads.current = async (file) => {
    started.push(file.name)
    await Promise.resolve()
    return { assetId: `asset-${file.name}` }
  }
  match.loadMatchBoardAction.mockResolvedValue({ ok: true, board: BOARD })
  match.requestLabelHelpAction.mockResolvedValue({ ok: true })
  match.suggestSpecialAction.mockResolvedValue({ ok: true })
  quality.hints = null
  area.setAreaLabelAction.mockImplementation(
    async (_asset: string, subjectId: string) => ({ ok: true, subjectId })
  )
  area.loadAreaLabelsAction.mockResolvedValue({
    ok: true,
    offered: false,
    places: [],
    labels: [],
  })
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  vi.stubGlobal("fetch", vi.fn(labelApi))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function Opener({
  opts,
  label = "Add photos",
}: {
  opts: OpenAddOptions
  label?: string
}) {
  const openAdd = useAdd()
  return (
    <button type="button" onClick={() => openAdd?.(opts)}>
      {label}
    </button>
  )
}

function Host({
  opts,
  venueId = "venue-1",
  venueName = "The Bell",
}: {
  opts: OpenAddOptions
  venueId?: string
  venueName?: string
}) {
  return (
    <AddHost
      blocked={null}
      captchaRequired={false}
      captchaSiteKey={null}
      venueId={venueId}
      venueName={venueName}
    >
      <Opener opts={opts} />
    </AddHost>
  )
}

function host(opts: OpenAddOptions) {
  return render(<Host opts={opts} />)
}

const gallery = () =>
  document.querySelector<HTMLInputElement>(
    'input[data-photo-source="library"]'
  )!

/** Opens Add photos and picks `files` from the gallery. */
async function pick(opts: OpenAddOptions, files: File[]) {
  const user = userEvent.setup()
  host(opts)
  await user.click(screen.getByRole("button", { name: "Add photos" }))
  await user.upload(gallery(), files)
  return user
}

const matchDialog = () => screen.getByRole("dialog")
const sentFor = (asset: string) =>
  posted.filter((p) => p.input.assetId === asset)

/** Counts every tap the person makes in the app (the OS picker excluded). */
function counted(user: ReturnType<typeof userEvent.setup>) {
  let taps = 0
  return {
    taps: () => taps,
    click: async (element: Element) => {
      taps += 1
      await user.click(element)
    },
  }
}

describe("the venue (spec §5.1)", () => {
  it("is named under Match's title and on the end", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await waitFor(() =>
      expect(within(dialog).getByText("For The Bell")).toBeTruthy()
    )
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    expect(
      await within(matchDialog()).findByText("1 photo for The Bell")
    ).toBeTruthy()
  })
})

describe("measured journeys", () => {
  it("1 photo for a requested slot: one tap in the app, no typing (AC01)", async () => {
    const user = userEvent.setup()
    const tap = counted(user)
    host({
      slot: { kind: "dish", itemId: "item-bhaji", name: "Onion Bhaji" },
    })
    await tap.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(gallery(), [jpeg("one.jpg")])
    await waitFor(() => expect(sentFor("asset-one.jpg")).toHaveLength(1))
    expect(sentFor("asset-one.jpg")[0].input).toMatchObject({
      items: [{ itemId: "item-bhaji", variantId: null }],
    })
    expect(
      within(matchDialog()).getByRole("heading", { name: "1 slot filled" })
    ).toBeTruthy()
    expect(tap.taps()).toBe(1)
  })

  it("10 photos of 3 dishes: three groups in 7 taps, each photo labelled (AC05)", async () => {
    const user = userEvent.setup()
    const tap = counted(user)
    host({ match: { place: PASS } })
    await tap.click(screen.getByRole("button", { name: "Add photos" }))
    const files = Array.from({ length: 10 }, (_, i) =>
      jpeg(`p${i + 1}.jpg`, i + 1)
    )
    await user.upload(gallery(), files)
    let dialog = await screen.findByRole("dialog", { name: "Photo 1 of 10" })
    expect(within(dialog).getByText("10 not matched yet")).toBeTruthy()
    // Nothing is grouped until the person says so (§5.4).
    expect(within(dialog).getByText(/Tap the last photo/)).toBeTruthy()
    await tap.click(within(dialog).getByRole("button", { name: "Photo 4 too" }))
    expect(
      within(dialog)
        .getAllByRole("button", { pressed: true })
        .map((b) => b.getAttribute("aria-label"))
    ).toEqual(["Photo 2 too", "Photo 3 too", "Photo 4 too"])
    await tap.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    dialog = await screen.findByRole("dialog", { name: "Photo 5 of 10" })
    expect(within(dialog).getByText("6 not matched yet")).toBeTruthy()
    await tap.click(within(dialog).getByRole("button", { name: "Photo 7 too" }))
    await tap.click(
      await within(dialog).findByRole("button", { name: /Chicken Tikka/ })
    )
    dialog = await screen.findByRole("dialog", { name: "Photo 8 of 10" })
    await tap.click(within(dialog).getByRole("button", { name: "All 3 left" }))
    await tap.click(
      await within(dialog).findByRole("button", { name: /Mango Lassi/ })
    )
    await waitFor(() => expect(posted).toHaveLength(10))
    const itemOf = (n: number) =>
      (sentFor(`asset-p${n}.jpg`)[0].input.items as { itemId: string }[])[0]
        .itemId
    expect([1, 2, 3, 4].map(itemOf)).toEqual(Array(4).fill("item-bhaji"))
    expect([5, 6, 7].map(itemOf)).toEqual(Array(3).fill("item-tikka"))
    expect([8, 9, 10].map(itemOf)).toEqual(Array(3).fill("item-lassi"))
    const end = within(matchDialog())
    expect(end.getByRole("heading", { name: "3 slots filled" })).toBeTruthy()
    expect(end.getByText("10 photos for The Bell")).toBeTruthy()
    expect(end.getByText("Onion Bhaji × 4")).toBeTruthy()
    expect(end.getByText("Chicken Tikka × 3")).toBeTruthy()
    expect(end.getByText("Mango Lassi × 3")).toBeTruthy()
    expect(tap.taps()).toBe(7)
  })

  it("lets a grouped photo go again with one tap", async () => {
    const user = await pick({ match: { place: PASS } }, [
      jpeg("a.jpg", 1),
      jpeg("b.jpg", 2),
      jpeg("c.jpg", 3),
    ])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 3" })
    await user.click(
      within(dialog).getByRole("button", { name: "Photo 3 too" })
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Photo 3 too" })
    )
    expect(
      within(dialog)
        .getAllByRole("button", { pressed: true })
        .map((b) => b.getAttribute("aria-label"))
    ).toEqual(["Photo 2 too"])
    await user.click(
      within(dialog).getByRole("button", { name: "Photo 2 too" })
    )
    expect(within(dialog).queryAllByRole("button", { pressed: true })).toEqual(
      []
    )
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    expect(
      await screen.findByRole("dialog", { name: "Photo 2 of 3" })
    ).toBeTruthy()
  })
})

describe("the picker cancelled (spec §6 S2)", () => {
  it("changes nothing, and the next pick opens Match as usual", async () => {
    const user = userEvent.setup()
    host({ match: { place: PASS } })
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    // The phone's picker closed with nothing chosen.
    gallery().dispatchEvent(new Event("cancel"))
    await user.upload(gallery(), [])
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(started).toEqual([])
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(gallery(), [jpeg("a.jpg")])
    expect(
      await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    ).toBeTruthy()
  })
})

describe("workflow events (S2-METRICS, K5)", () => {
  const events = () =>
    vi.mocked(trackFlow).mock.calls.map(([e]) => [e.name, e.route ?? null])

  it("records I'm not sure as its own event", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("u.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      within(dialog).getByRole("button", { name: /I'm not sure/ })
    )
    await waitFor(() =>
      expect(events().map(([name]) => name)).toContain("label_uncertain")
    )
    expect(events().map(([name]) => name)).not.toContain("not_for_slot")
  })

  it("records photos started from Asked for under the request route", async () => {
    await pick({ match: { place: PASS }, route: "request" }, [jpeg("r.jpg")])
    await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    expect(events()).toContainEqual(["flow_started", "request"])
  })
})

describe("I'm not sure (FA-4, AC03)", () => {
  it("sends the photo to the manager with the optional note, and no slot", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(within(dialog).getByRole("button", { name: "Add a note" }))
    await user.type(
      within(dialog).getByRole("textbox", {
        name: "Note for your manager (optional)",
      }),
      "New special, by the window"
    )
    await user.click(
      within(dialog).getByRole("button", { name: /I'm not sure/ })
    )
    await waitFor(() =>
      expect(match.requestLabelHelpAction).toHaveBeenCalledWith("asset-a.jpg")
    )
    await waitFor(() => expect(sentFor("asset-a.jpg")).toHaveLength(1))
    expect(sentFor("asset-a.jpg")[0].input).toMatchObject({
      items: [],
      contentTypes: [],
      note: "New special, by the window",
    })
    expect(
      await within(matchDialog()).findByText(
        "1 photo is with your manager, who will choose its slot."
      )
    ).toBeTruthy()
    expect(
      within(matchDialog()).getByRole("heading", { name: "No slots filled" })
    ).toBeTruthy()
  })

  it("needs no typing: without a note no label is sent", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      within(dialog).getByRole("button", { name: /I'm not sure/ })
    )
    await waitFor(() =>
      expect(match.requestLabelHelpAction).toHaveBeenCalledWith("asset-a.jpg")
    )
    expect(sentFor("asset-a.jpg")).toEqual([])
  })

  it("keeps the photo under Match later when the manager could not be told", async () => {
    match.requestLabelHelpAction.mockResolvedValue({
      ok: false,
      message: "No signal",
    })
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      within(dialog).getByRole("button", { name: /I'm not sure/ })
    )
    await waitFor(() =>
      expect(match.requestLabelHelpAction).toHaveBeenCalledTimes(2)
    )
    expect(
      await within(matchDialog()).findByText(
        "1 photo is under Match later on Album."
      )
    ).toBeTruthy()
  })
})

describe("choosing the slot (spec §5.3)", () => {
  it("offers the person's recent slots first, never applied", async () => {
    window.localStorage.setItem(
      "nabalens.match.recent-slots",
      JSON.stringify({ venue: "venue-1", slots: ["dish:item-korma-chicken"] })
    )
    await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    const recent = await within(dialog).findByRole("list", { name: "Recent" })
    expect(within(recent).getByText("Garlic Naan")).toBeTruthy()
    expect(
      within(recent).getByText("Waiting · another photo is welcome")
    ).toBeTruthy()
    // Offered, not applied: nothing is sent until a tap.
    expect(started).toEqual([])
  })

  it("remembers a matched slot as recent for this venue", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    expect(
      JSON.parse(window.localStorage.getItem("nabalens.match.recent-slots")!)
    ).toEqual({ venue: "venue-1", slots: ["dish:item-bhaji"] })
  })

  it("offers a slot matched earlier in this visit under Recent once it is Waiting (E5)", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    let dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    await within(matchDialog()).findByRole("heading", { name: "1 slot filled" })
    await waitFor(() =>
      expect(
        matchDialog().querySelector('[data-slot="match-summary"] li')
      ).toHaveProperty("dataset.state", "waiting")
    )
    // Closed without Album reading the slot again: no reload.
    await user.click(screen.getByRole("button", { name: "Close" }))
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(gallery(), [jpeg("b.jpg", 5)])
    dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    const recent = await within(dialog).findByRole("list", { name: "Recent" })
    expect(within(recent).getByText("Onion Bhaji")).toBeTruthy()
  })

  it("finds a dish by its other name and a slot already waiting", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    const search = await within(dialog).findByRole("searchbox", {
      name: "Search all slots",
    })
    await user.type(search, "pakoras")
    expect(
      within(dialog).getByRole("button", { name: /Onion Bhaji/ })
    ).toBeTruthy()
    await user.clear(search)
    await user.type(search, "naan")
    const waiting = within(dialog).getByRole("button", { name: /Garlic Naan/ })
    expect(waiting.textContent).toContain("another photo is welcome")
    await user.click(waiting)
    await waitFor(() => expect(sentFor("asset-a.jpg")).toHaveLength(1))
    expect(sentFor("asset-a.jpg")[0].input).toMatchObject({
      items: [{ itemId: "item-korma-chicken", variantId: null }],
    })
  })
})

describe("a dish not on the menu (S1-MENUS)", () => {
  it("suggests the searched name as a special, then the photo goes to the manager", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.type(
      await within(dialog).findByRole("searchbox", {
        name: "Search all slots",
      }),
      "Pumpkin soup"
    )
    await user.click(within(dialog).getByRole("button", { name: "It's food" }))
    expect(match.suggestSpecialAction).toHaveBeenCalledWith(
      "Pumpkin soup",
      "food"
    )
    expect(
      await within(dialog).findByText(
        '"Pumpkin soup" is suggested to your manager. For this photo, choose I\'m not sure.'
      )
    ).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", { name: /I'm not sure/ })
    )
    await waitFor(() =>
      expect(match.requestLabelHelpAction).toHaveBeenCalledWith("asset-a.jpg")
    )
  })

  it("says when the suggestion could not be made, and keeps the choice", async () => {
    match.suggestSpecialAction.mockResolvedValue({
      ok: false,
      message: "Try again in a moment.",
    })
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.type(
      await within(dialog).findByRole("searchbox", {
        name: "Search all slots",
      }),
      "Pumpkin soup"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "It's a drink" })
    )
    expect(
      await within(dialog).findByText(/It could not be suggested/)
    ).toBeTruthy()
    expect(
      within(dialog).getByRole("button", { name: "It's food" })
    ).toBeTruthy()
  })
})

describe("advice that never blocks (spec §5.5)", () => {
  it("says a photo looks dark and small, and it still sends", async () => {
    quality.hints = { width: 900, height: 600, brightness: 20, sharpness: 2 }
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    expect(
      await within(dialog).findByText(
        "This photo looks dark. You can still send it."
      )
    ).toBeTruthy()
    expect(within(dialog).getByText(/This photo is small/)).toBeTruthy()
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    await waitFor(() => expect(sentFor("asset-a.jpg")).toHaveLength(1))
  })

  it("marks a photo the server had already (same bytes, same venue)", async () => {
    uploads.current = async (file) => ({
      assetId: `asset-${file.name}`,
      duplicate: true,
    })
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    expect(
      await within(matchDialog()).findByText(
        /Sent before: it won't count twice/
      )
    ).toBeTruthy()
  })
})

describe("a venue change before sending (AC11, spec §6 S2)", () => {
  it("asks again for matched photos still waiting their turn, never reserving them at the new venue (V7)", async () => {
    // The first two photos take their turn and hold it; the other two wait
    // in the queue (maxParallelUploads is 2) with no reservation yet.
    const holds: (() => void)[] = []
    const venues: (string | undefined)[] = []
    uploads.current = async (file, context) => {
      started.push(file.name)
      venues.push(context.venueId)
      await new Promise<void>((resolve) => holds.push(resolve))
      return { assetId: `asset-${file.name}` }
    }
    const user = userEvent.setup()
    const view = render(<Host opts={{ match: { place: PASS } }} />)
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(
      gallery(),
      [1, 2, 3, 4].map((n) => jpeg(`q${n}.jpg`, n))
    )
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 4" })
    await user.click(
      within(dialog).getByRole("button", { name: "Photo 4 too" })
    )
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    await waitFor(() => expect(started).toEqual(["q1.jpg", "q2.jpg"]))
    // Each reservation names the venue the photo was matched for.
    expect(venues).toEqual(["venue-1", "venue-1"])

    match.loadMatchBoardAction.mockResolvedValue({
      ok: true,
      board: { ...BOARD, venue: { id: "venue-2", name: "The Crown" } },
    })
    view.rerender(
      <Host
        opts={{ match: { place: PASS } }}
        venueId="venue-2"
        venueName="The Crown"
      />
    )
    expect(
      await within(matchDialog()).findByText(
        "You are now adding photos for The Crown. Choose the slot again for 2 photos."
      )
    ).toBeTruthy()
    expect(
      await within(matchDialog()).findByText("2 not matched yet")
    ).toBeTruthy()

    // The two in flight finish at the old venue; the two taken back are
    // dropped by the queue, never reserved.
    for (const release of holds) release()
    await waitFor(() => expect(sentFor("asset-q1.jpg")).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(started).toEqual(["q1.jpg", "q2.jpg"])
  })

  it("drops each queue item taken back, even when one photo waits twice across two switches (W6)", async () => {
    // q1 and q2 hold their turn; q3 and q4 wait. A->B takes them back and
    // they are matched again at B, so each waits as two queue items. B->C
    // before any of them has its turn takes all four back: none is reserved
    // at C unasked, and matched again at C each is sent once, at C.
    const holds: (() => void)[] = []
    const sent: [string, string | undefined][] = []
    uploads.current = async (file, context) => {
      started.push(file.name)
      sent.push([file.name, context.venueId])
      if (file.name === "q1.jpg" || file.name === "q2.jpg")
        await new Promise<void>((resolve) => holds.push(resolve))
      return { assetId: `asset-${file.name}-${context.venueId}` }
    }
    const user = userEvent.setup()
    const view = render(<Host opts={{ match: { place: PASS } }} />)
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(
      gallery(),
      [1, 2, 3, 4].map((n) => jpeg(`q${n}.jpg`, n))
    )
    let dialog = await screen.findByRole("dialog", { name: "Photo 1 of 4" })
    await user.click(
      within(dialog).getByRole("button", { name: "Photo 4 too" })
    )
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    await waitFor(() => expect(started).toEqual(["q1.jpg", "q2.jpg"]))

    const switchTo = async (id: string, name: string) => {
      match.loadMatchBoardAction.mockResolvedValue({
        ok: true,
        board: { ...BOARD, venue: { id, name } },
      })
      view.rerender(
        <Host opts={{ match: { place: PASS } }} venueId={id} venueName={name} />
      )
      expect(
        await within(matchDialog()).findByText(
          `You are now adding photos for ${name}. Choose the slot again for 2 photos.`
        )
      ).toBeTruthy()
    }
    const matchAgain = async () => {
      dialog = await screen.findByRole("dialog", { name: /Photo 3 of 4/ })
      await user.click(
        await within(dialog).findByRole("button", { name: "Photo 4 too" })
      )
      // Onion Bhaji is still sending (q1, q2), so Match holds it back.
      await user.click(
        await within(dialog).findByRole("button", { name: /Chicken Tikka/ })
      )
    }

    await switchTo("venue-2", "The Crown")
    await matchAgain()
    await switchTo("venue-3", "The Swan")

    // q1 and q2 finish at the first venue; all four waiting items drop.
    for (const release of holds) release()
    await waitFor(() => expect(sentFor("asset-q2.jpg-venue-1")).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(sent).toEqual([
      ["q1.jpg", "venue-1"],
      ["q2.jpg", "venue-1"],
    ])

    // Matched again at C: each photo is sent once, for C.
    await matchAgain()
    await waitFor(() => expect(sentFor("asset-q4.jpg-venue-3")).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(sent.slice(2).sort()).toEqual([
      ["q3.jpg", "venue-3"],
      ["q4.jpg", "venue-3"],
    ])
  })

  it("reads Sent, not Waiting, while a dish label is not on the photo (V8)", async () => {
    // The label is only staged ("pending") and finalise reports none.
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (init?.method === "POST") {
        const sent = JSON.parse(String(init.body))
        posted.push(sent)
        return Promise.resolve({
          json: async () => ({
            ok: true,
            assetId: sent.input.assetId,
            state: "pending",
          }),
        } as Response)
      }
      return labelApi(String(url), init)
    })
    const user = await pick({ match: { place: PASS } }, [jpeg("s.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    await waitFor(() => expect(sentFor("asset-s.jpg")).toHaveLength(1))
    const row = await waitFor(() => {
      const li = matchDialog().querySelector<HTMLElement>(
        '[data-slot="match-summary"] li'
      )
      expect(li?.dataset.state).toBe("sent")
      return li!
    })
    expect(within(row).getByText("Sent")).toBeTruthy()
    expect(
      within(matchDialog()).getByRole("heading", { name: "No slots filled" })
    ).toBeTruthy()
  })

  it("loads the new venue's menu, so a dish matched there keeps its label (V8)", async () => {
    const user = userEvent.setup()
    const view = render(<Host opts={{ match: { place: PASS } }} />)
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(gallery(), [jpeg("v8.jpg", 1)])
    await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    const menuReads = () =>
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, init]) =>
            !init?.method &&
            String(url).includes("upload-labels") &&
            !String(url).includes("attention")
        ).length
    await waitFor(() => expect(menuReads()).toBe(1))
    view.rerender(
      <Host
        opts={{ match: { place: PASS } }}
        venueId="venue-2"
        venueName="The Crown"
      />
    )
    await waitFor(() => expect(menuReads()).toBe(2))
  })

  it("reads the new venue's slots and says so", async () => {
    const user = userEvent.setup()
    const view = render(<Host opts={{ match: { place: PASS } }} />)
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(gallery(), [jpeg("a.jpg", 1), jpeg("b.jpg", 2)])
    await screen.findByRole("dialog", { name: "Photo 1 of 2" })
    await waitFor(() =>
      expect(match.loadMatchBoardAction).toHaveBeenCalledTimes(1)
    )
    match.loadMatchBoardAction.mockResolvedValue({
      ok: true,
      board: { ...BOARD, venue: { id: "venue-2", name: "The Crown" } },
    })
    view.rerender(
      <Host
        opts={{ match: { place: PASS } }}
        venueId="venue-2"
        venueName="The Crown"
      />
    )
    expect(
      await within(matchDialog()).findByText(
        "You are now adding photos for The Crown. The slots below are The Crown's."
      )
    ).toBeTruthy()
    await waitFor(() =>
      expect(match.loadMatchBoardAction).toHaveBeenCalledTimes(2)
    )
    expect(await within(matchDialog()).findByText("For The Crown")).toBeTruthy()
  })
})

describe("S3-R12: a dish used once stays one tap away (X4, spec §5.4, AC05)", () => {
  it("labels three photos of one dish with another between them, with no typing", async () => {
    const user = userEvent.setup()
    host({ match: { place: PASS } })
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(gallery(), [
      jpeg("a.jpg", 1),
      jpeg("g.jpg", 2),
      jpeg("b.jpg", 3),
      jpeg("c.jpg", 4),
    ])
    let dialog = await screen.findByRole("dialog", { name: "Photo 1 of 4" })
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    dialog = await screen.findByRole("dialog", { name: "Photo 2 of 4" })
    await user.click(within(dialog).getByRole("button", { name: /The garden/ }))
    // Photo 3: the dish matched on photo 1 is under Recent, marked, not gone.
    dialog = await screen.findByRole("dialog", { name: "Photo 3 of 4" })
    let recent = within(dialog).getByRole("list", { name: "Recent" })
    const bhaji = within(recent).getByRole("button", { name: /Onion Bhaji/ })
    expect(bhaji.textContent).toContain(
      "Matched just now · another photo is welcome"
    )
    // A search finds it too, and never offers it as a new special.
    const search = within(dialog).getByRole("searchbox", {
      name: "Search all slots",
    })
    await user.type(search, "bhaji")
    expect(
      within(
        within(dialog).getByRole("list", { name: "Search all slots" })
      ).getByRole("button", { name: /Onion Bhaji/ })
    ).toBeTruthy()
    expect(within(dialog).queryByText(/Not on the menu\?/)).toBeNull()
    await user.clear(search)
    recent = within(dialog).getByRole("list", { name: "Recent" })
    await user.click(
      within(recent).getByRole("button", { name: /Onion Bhaji/ })
    )
    // Photo 4: one tap again.
    dialog = await screen.findByRole("dialog", { name: "Photo 4 of 4" })
    recent = within(dialog).getByRole("list", { name: "Recent" })
    await user.click(
      within(recent).getByRole("button", { name: /Onion Bhaji/ })
    )
    for (const asset of ["asset-a.jpg", "asset-b.jpg", "asset-c.jpg"])
      await waitFor(() =>
        expect(sentFor(asset)[0]?.input).toMatchObject({
          items: [{ itemId: "item-bhaji", variantId: null }],
        })
      )
    expect(
      await within(matchDialog()).findByText("Onion Bhaji × 3")
    ).toBeTruthy()
  })
})

describe("S3-R12: a dish already in the album (X5, spec §5.3, §6)", () => {
  it("is found by search and matched, and Not on the menu? is not offered", async () => {
    match.loadMatchBoardAction.mockResolvedValue({
      ok: true,
      board: {
        ...BOARD,
        filled: [
          {
            // On the menu (the fixture's madras), already in the album.
            id: "dish:item-madras-chicken",
            name: "Lamb Rogan Josh",
            group: "Mains",
            place: PASS,
            placeLabel: "Kitchen pass",
            brief: null,
            target: {
              kind: "dish",
              itemId: "item-madras-chicken",
              name: "Lamb Rogan Josh",
            },
            filled: "accepted",
          },
        ],
      } satisfies MatchBoard,
    })
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    // Never suggested as an empty slot.
    expect(
      within(dialog).queryByRole("button", { name: /Lamb Rogan Josh/ })
    ).toBeNull()
    await user.type(
      await within(dialog).findByRole("searchbox", {
        name: "Search all slots",
      }),
      "rogan josh"
    )
    const rogan = within(dialog).getByRole("button", {
      name: /Lamb Rogan Josh/,
    })
    expect(rogan.textContent).toContain(
      "In the album · another photo is welcome"
    )
    expect(within(dialog).queryByText(/Not on the menu\?/)).toBeNull()
    await user.click(rogan)
    await waitFor(() =>
      expect(sentFor("asset-a.jpg")[0]?.input).toMatchObject({
        items: [{ itemId: "item-madras-chicken", variantId: null }],
      })
    )
  })
})

describe("S3-R12: each photo's progress and Retry in Match (X6, spec §5.2, §5.4)", () => {
  it("shows Sending with its percent on the row, as a bar a screen reader reads", async () => {
    let release: () => void = () => {}
    uploads.current = async (file, context) => {
      started.push(file.name)
      context.onProgress(0.4)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { assetId: `asset-${file.name}` }
    }
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    const bar = await within(matchDialog()).findByRole("progressbar", {
      name: "Onion Bhaji",
    })
    expect(bar.getAttribute("aria-valuetext")).toBe("Sending 40%")
    expect(
      matchDialog().querySelector('[data-slot="match-row-state"]')?.textContent
    ).toContain("Sending 40%")
    release()
    await waitFor(() =>
      expect(
        matchDialog().querySelector('[data-slot="match-summary"] li')
      ).toHaveProperty("dataset.state", "waiting")
    )
    expect(within(matchDialog()).queryByRole("progressbar")).toBeNull()
  })

  it("offers Retry on a row that didn't send: the same photo is sent again, once", async () => {
    let fail = true
    uploads.current = async (file) => {
      started.push(file.name)
      await Promise.resolve()
      if (fail) throw new Error("network down")
      return { assetId: `asset-${file.name}` }
    }
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    const retry = await within(matchDialog()).findByRole(
      "button",
      { name: "Retry Onion Bhaji" },
      { timeout: 8000 }
    )
    expect(
      within(matchDialog()).getByText(
        "1 photo didn't send. Choose Retry; it won't be sent twice."
      )
    ).toBeTruthy()
    fail = false
    await user.click(retry)
    await waitFor(() =>
      expect(
        matchDialog().querySelector('[data-slot="match-summary"] li')
      ).toHaveProperty("dataset.state", "waiting")
    )
    // One retry of the one queue item: two attempts, one label send.
    expect(started).toEqual(["a.jpg", "a.jpg"])
    expect(sentFor("asset-a.jpg")).toHaveLength(1)
    expect(within(matchDialog()).queryByText(/didn't send/)).toBeNull()
  }, 20000)

  it("says a photo the server could not finish for good is still in the gallery, with no Retry", async () => {
    uploads.current = async (file) => {
      started.push(file.name)
      await Promise.resolve()
      throw Object.assign(new Error("This file could not be processed."), {
        error: {
          code: "processing_failed",
          message: "This file could not be processed.",
          retryable: false,
        },
      })
    }
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    expect(
      await within(matchDialog()).findByText(
        /couldn't be finished, and trying again won't help\. It is still in your gallery/,
        undefined,
        { timeout: 8000 }
      )
    ).toBeTruthy()
    expect(
      within(matchDialog()).queryByRole("button", { name: /^Retry/ })
    ).toBeNull()
    expect(
      matchDialog().querySelector('[data-slot="match-row-state"]')?.textContent
    ).toContain("Couldn't finish")
  }, 20000)
})
