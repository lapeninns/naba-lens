// @vitest-environment jsdom
// Match on add (DESIGN.md §6.1, D9; Album AL-1): Add photos opens the gallery
// for up to 20 photos, then Match shows one photo at a time with "Which
// empty slot is this?", suggestions (current place first), a search, Match
// later and Not for a slot. A dish match sends the dish as the photo's menu
// label, an area match its venue-area label; Match later sends it with no
// label, Not for a slot with what it shows. A Needed slot's tile opens the
// gallery for one photo that goes straight to it. Add has no camera.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AddHost } from "@/app/staff/_shell/add-host"
import type { MatchBoard } from "@/components/nabalens/album/match/model"
import {
  AddTrigger,
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import type { Uploader } from "@/components/nabalens/upload-queue"

import { CATALOGUE } from "./labels-fixtures"

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
}

const { supabase, uploads, actions, match, area } = vi.hoisted(() => ({
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
  match: { loadMatchBoardAction: vi.fn() },
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
    body = { ok: true, assetId: sent.input.assetId, state: "pending" }
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

function host(opts: OpenAddOptions, role: "staff" | "manager" = "staff") {
  return render(
    <AddHost
      blocked={null}
      captchaRequired={false}
      captchaSiteKey={null}
      role={role}
    >
      <Opener opts={opts} />
    </AddHost>
  )
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

describe("picking", () => {
  it("opens the gallery for several photos, with no camera and no capture", () => {
    host({ match: { place: PASS } })
    const input = gallery()
    const click = vi.spyOn(input, "click")
    fireEvent.click(screen.getByRole("button", { name: "Add photos" }))
    expect(click).toHaveBeenCalledTimes(1)
    expect(input.multiple).toBe(true)
    expect(input.accept).not.toMatch(/video/)
    expect(document.querySelector("input[capture]")).toBeNull()
    expect(
      document.querySelector('input[data-photo-source="camera"]')
    ).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("opens Match on the first photo taken, with the strip and the question", async () => {
    await pick({ match: { place: PASS } }, [
      jpeg("b.jpg", 20),
      jpeg("a.jpg", 10),
      jpeg("c.jpg", 30),
    ])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 3" })
    const strip = within(dialog).getByRole("list", { name: "Your photos" })
    const photos = within(strip).getAllByRole("button")
    expect(photos).toHaveLength(3)
    expect(photos[0].getAttribute("aria-current")).toBe("true")
    expect(photos[0].getAttribute("aria-label")).toBe(
      "Photo 1 of 3: not matched yet"
    )
    expect(
      within(dialog).getByRole("img", { name: "Photo 1 of 3" })
    ).toBeTruthy()
    expect(
      within(dialog).getByRole("heading", { name: "Which empty slot is this?" })
    ).toBeTruthy()
    // Nothing is sent before a photo has its answer.
    expect(started).toEqual([])
  })

  it("suggests the current place's empty slots first, then the place last matched", async () => {
    window.localStorage.setItem("nabalens.match.last-place", GARDEN)
    await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    const suggested = await within(dialog).findByRole("list", {
      name: "Suggested",
    })
    expect(
      within(suggested)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual([
      expect.stringContaining("Onion Bhaji"),
      expect.stringContaining("Chicken Tikka"),
      expect.stringContaining("The garden"),
      expect.stringContaining("Mango Lassi"),
    ])
    // The brief is shown with the slot (DESIGN.md §5 Brief).
    expect(
      within(suggested).getByText("The whole plate, from above")
    ).toBeTruthy()
    window.localStorage.clear()
  })

  it("takes 20 photos at most and says how many stayed in the gallery", async () => {
    const files = Array.from({ length: 22 }, (_, i) => jpeg(`p${i}.jpg`, i))
    await pick({ match: {} }, files)
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 20" })
    expect(
      within(dialog).getByText(
        "You can match 20 photos at a time. 2 photos were left in your gallery."
      )
    ).toBeTruthy()
  })
})

describe("matching", () => {
  it("matches a dish: the photo is sent at once with that dish as its menu label", async () => {
    const user = await pick({ match: { place: PASS } }, [
      jpeg("a.jpg", 1),
      jpeg("b.jpg", 2),
    ])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 2" })
    await user.click(
      await within(dialog).findByRole("button", { name: /Onion Bhaji/ })
    )
    await waitFor(() => expect(sentFor("asset-a.jpg")).toHaveLength(1))
    expect(sentFor("asset-a.jpg")[0]).toEqual({
      venueId: "venue-1",
      input: expect.objectContaining({
        assetId: "asset-a.jpg",
        catalogueVersionId: "version-1",
        items: [{ itemId: "item-bhaji", variantId: null }],
        contentTypes: [],
      }),
    })
    // On to the next photo; the filled slot is not offered again.
    expect(screen.getByRole("dialog", { name: "Photo 2 of 2" })).toBeTruthy()
    const strip = within(matchDialog()).getByRole("list", {
      name: "Your photos",
    })
    expect(
      within(strip).getAllByRole("button")[0].getAttribute("aria-label")
    ).toBe("Photo 1 of 2: in Onion Bhaji")
    const suggested = await within(matchDialog()).findByRole("list", {
      name: "Suggested",
    })
    expect(
      within(suggested).queryByRole("button", { name: /Onion Bhaji/ })
    ).toBeNull()
  })

  it("matches an area from the search: its venue-area label is saved", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("g.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.type(
      await within(dialog).findByRole("searchbox", {
        name: "Search all empty slots",
      }),
      "garden"
    )
    expect(within(dialog).getByText("1 empty slot")).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: /The garden/ }))
    await waitFor(() =>
      expect(area.setAreaLabelAction).toHaveBeenCalledWith(
        "asset-g.jpg",
        GARDEN
      )
    )
    // An area is not a menu label.
    expect(sentFor("asset-g.jpg")).toEqual([])
    expect(await screen.findByText("1 slot filled")).toBeTruthy()
  })

  it("says that amenities are not matched here when one is searched for", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("d.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.type(
      await within(dialog).findByRole("searchbox", {
        name: "Search all empty slots",
      }),
      "darts"
    )
    expect(
      within(dialog).getByText('No empty slot matches "darts".')
    ).toBeTruthy()
    expect(
      within(dialog).getByText(/Amenities are not matched here/)
    ).toBeTruthy()
  })

  it("Match later sends the photo with no label", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("l.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      within(dialog).getByRole("button", { name: "Match later" })
    )
    await waitFor(() => expect(started).toEqual(["l.jpg"]))
    expect(
      await screen.findByText("1 photo is under Match later on Album.")
    ).toBeTruthy()
    expect(screen.getByText("No slots filled")).toBeTruthy()
    // Give the label sheet every chance: nothing is sent for it.
    await new Promise((r) => setTimeout(r, 20))
    expect(sentFor("asset-l.jpg")).toEqual([])
  })

  it("Not for a slot asks what it shows, then sends that as its label", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("t.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      within(dialog).getByRole("button", { name: "Not for a slot" })
    )
    expect(
      within(dialog).getByRole("heading", { name: "What does it show?" })
    ).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "Team" }))
    await waitFor(() => expect(sentFor("asset-t.jpg")).toHaveLength(1))
    expect(sentFor("asset-t.jpg")[0].input).toEqual(
      expect.objectContaining({ items: [], contentTypes: ["team"] })
    )
    expect(
      await screen.findByText("1 photo is shared with the team with no slot.")
    ).toBeTruthy()
  })

  it("Back from Not for a slot returns to the slots", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("t.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      within(dialog).getByRole("button", { name: "Not for a slot" })
    )
    await user.click(within(dialog).getByRole("button", { name: "Back" }))
    expect(
      within(dialog).getByRole("heading", { name: "Which empty slot is this?" })
    ).toBeTruthy()
    expect(started).toEqual([])
  })

  it("closing early keeps the rest under Match later", async () => {
    const user = await pick({ match: { place: PASS } }, [
      jpeg("x.jpg", 1),
      jpeg("y.jpg", 2),
    ])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 2" })
    await user.click(
      within(dialog).getByRole("button", { name: "Match the rest later" })
    )
    await waitFor(() => expect(started.sort()).toEqual(["x.jpg", "y.jpg"]))
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Photo/ })).toBeNull()
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(posted).toEqual([])
  })

  it("can be done by keyboard", async () => {
    const user = await pick({ match: { place: PASS } }, [jpeg("k.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    const slot = await within(dialog).findByRole("button", {
      name: /Chicken Tikka/,
    })
    slot.focus()
    await user.keyboard("{Enter}")
    await waitFor(() => expect(sentFor("asset-k.jpg")).toHaveLength(1))
  })

  it("names every control", async () => {
    await pick({ match: { place: PASS } }, [jpeg("a.jpg"), jpeg("b.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 2" })
    await within(dialog).findByRole("list", { name: "Suggested" })
    const buttons = within(dialog).getAllByRole("button")
    expect(within(dialog).getAllByRole("button", { name: /\S/ })).toHaveLength(
      buttons.length
    )
    expect(dialog.textContent).not.toMatch(/camera|take a photo|upload/i)
  })

  it("offers to try again when the empty slots could not be read", async () => {
    match.loadMatchBoardAction
      .mockResolvedValueOnce({ ok: false, message: "No signal." })
      .mockResolvedValueOnce({ ok: true, board: BOARD })
    const user = await pick({ match: { place: PASS } }, [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      await within(dialog).findByRole("button", { name: "Try again" })
    )
    expect(
      await within(dialog).findByRole("list", { name: "Suggested" })
    ).toBeTruthy()
    // Match later is there all along: a photo is never stuck.
    expect(
      within(dialog).getByRole("button", { name: "Match later" })
    ).toBeTruthy()
  })
})

describe("the end", () => {
  it('says "2 slots filled", what happens next, each slot Waiting, and See the album', async () => {
    const user = await pick({ match: { place: PASS } }, [
      jpeg("a.jpg", 1),
      jpeg("b.jpg", 2),
      jpeg("c.jpg", 3),
    ])
    await screen.findByRole("dialog", { name: "Photo 1 of 3" })
    await user.click(
      await within(matchDialog()).findByRole("button", { name: /Onion Bhaji/ })
    )
    await user.click(
      await within(matchDialog()).findByRole("button", {
        name: /Chicken Tikka/,
      })
    )
    await user.click(
      within(matchDialog()).getByRole("button", { name: "Match later" })
    )
    const summary = await screen.findByText("2 slots filled")
    const dialog = matchDialog()
    expect(dialog.contains(summary)).toBe(true)
    expect(
      within(dialog).getByText(
        "Each one shows as Waiting in the album until your manager has looked at it."
      )
    ).toBeTruthy()
    expect(
      within(dialog).getByText("1 photo is under Match later on Album.")
    ).toBeTruthy()
    await waitFor(() =>
      expect(within(dialog).getAllByText("Waiting")).toHaveLength(2)
    )
    const link = within(dialog).getByRole("link", { name: "See the album" })
    expect(link.getAttribute("href")).toBe("/staff/tasks")
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy()
  })
})

describe("a Needed slot's tile", () => {
  it("opens the gallery for one photo that goes straight to the dish", async () => {
    const user = userEvent.setup()
    host({
      slot: { kind: "dish", itemId: "item-bhaji", name: "Onion Bhaji" },
    })
    const input = gallery()
    const click = vi.spyOn(input, "click")
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    expect(click).toHaveBeenCalledTimes(1)
    expect(input.multiple).toBe(false)
    await user.upload(input, [jpeg("one.jpg")])
    expect(await screen.findByText("1 slot filled")).toBeTruthy()
    await waitFor(() => expect(sentFor("asset-one.jpg")).toHaveLength(1))
    expect(sentFor("asset-one.jpg")[0].input).toEqual(
      expect.objectContaining({
        items: [{ itemId: "item-bhaji", variantId: null }],
      })
    )
    // No question to answer, so the slots are never read.
    expect(match.loadMatchBoardAction).not.toHaveBeenCalled()
    expect(screen.getByText("Onion Bhaji")).toBeTruthy()
  })

  it("puts an area slot's photo in that area", async () => {
    const user = userEvent.setup()
    host({ slot: { kind: "area", subjectId: GARDEN, name: "The garden" } })
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(gallery(), [jpeg("garden.jpg")])
    await waitFor(() =>
      expect(area.setAreaLabelAction).toHaveBeenCalledWith(
        "asset-garden.jpg",
        GARDEN
      )
    )
    expect(await screen.findByText("1 slot filled")).toBeTruthy()
  })

  it("an area that cannot be saved waits under Match later instead", async () => {
    area.setAreaLabelAction.mockResolvedValue({
      ok: false,
      message: "Not now.",
    })
    const user = userEvent.setup()
    host({ slot: { kind: "area", subjectId: GARDEN, name: "The garden" } })
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(gallery(), [jpeg("garden.jpg")])
    expect(
      await screen.findByText("1 photo is under Match later on Album.")
    ).toBeTruthy()
    // Tried when reserved and again when ready.
    expect(area.setAreaLabelAction).toHaveBeenCalledTimes(2)
    expect(screen.getByText("No slots filled")).toBeTruthy()
  })
})

describe("Add is gallery first", () => {
  it("has no camera control, capture input or camera words, and the Album tab opens Match", async () => {
    const user = userEvent.setup()
    render(
      <AddHost blocked={null} captchaRequired={false} captchaSiteKey={null}>
        <AddTrigger kind="tab" match />
      </AddHost>
    )
    const input = gallery()
    const click = vi.spyOn(input, "click")
    await user.click(screen.getByRole("button", { name: "Add" }))
    expect(click).toHaveBeenCalledTimes(1)
    await user.upload(input, [jpeg("a.jpg")])
    await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    expect(document.querySelector("input[capture]")).toBeNull()
    expect(document.body.textContent).not.toMatch(/camera|take a photo/i)
  })

  it("a manager account gets the gallery and today's sheet, not Match", async () => {
    const user = userEvent.setup()
    host({ match: { place: PASS } }, "manager")
    // A manager account has Add only once R8 says it can upload; without
    // the entry there is no Add at all.
    expect(screen.getByRole("button", { name: "Add photos" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    expect(screen.queryByRole("dialog", { name: /Photo/ })).toBeNull()
  })
})
