// @vitest-environment jsdom
// Match and upload repairs (release review R-1, DESIGN.md §2.8, §4, §6.1,
// §6.8, D9): Match's 20 photos reach a queue that holds 10 without losing
// any, files the queue would refuse are said to Match, a failed send opens
// the queue, Match later never needs attention, focus follows each match,
// a double tap doesn't match the next photo, and Album's tiles show a slot
// this phone is sending.
import type * as React from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AlbumAddTrigger } from "@/components/nabalens/album/album-add-trigger"
import { AlbumSlotTile } from "@/components/nabalens/album/album-home"
import { MATCH_TAP_GUARD_MS } from "@/components/nabalens/album/match/match-screen"
import type { AlbumSlot } from "@/lib/album/model"
import { MEDIA_LIMITS } from "@/lib/config/media"
import { AddHost } from "@/app/staff/_shell/add-host"
import type { MatchBoard } from "@/components/nabalens/album/match/model"
import {
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import type { Uploader } from "@/components/nabalens/upload-queue"

import { CATALOGUE, savedAnswer } from "./labels-fixtures"

// These tests cover the match-before-send flow (D9), which is what staff get
// when immediate posting (D20) is switched off with
// NEXT_PUBLIC_NABALENS_STAFF_ALBUM_POSTS=0.
vi.mock("@/lib/config/staff-album-posts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/staff-album-posts")>()),
  STAFF_ALBUM_POSTS: false,
}))


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

/** Uploads that wait until released, like a slow signal. */
function slowUploads() {
  const release: (() => void)[] = []
  let inFlight = 0
  let most = 0
  uploads.current = (file) => {
    started.push(file.name)
    inFlight += 1
    most = Math.max(most, inFlight)
    return new Promise((resolve) =>
      release.push(() => {
        inFlight -= 1
        resolve({ assetId: `asset-${file.name}` })
      })
    )
  }
  return {
    most: () => most,
    async drain() {
      for (
        let round = 0;
        round < 40 && release.length + inFlight > 0;
        round++
      ) {
        await act(async () => {
          while (release.length) release.shift()!()
          await new Promise((r) => setTimeout(r, 10))
        })
      }
    },
  }
}

function albumHost(children: React.ReactNode) {
  return render(
    <AddHost
      blocked={null}
      captchaRequired={false}
      captchaSiteKey={null}
      role="staff"
    >
      {children}
    </AddHost>
  )
}

const addTab = () =>
  document.querySelector<HTMLButtonElement>('[data-slot="album-add"]')!

describe("B1: Match never loses a photo to the queue's limit", () => {
  it("closing Match early with 15 photos sends all 15, never more than 10 at once", async () => {
    const slow = slowUploads()
    const files = Array.from({ length: 15 }, (_, i) => jpeg(`p${i}.jpg`, i))
    const user = await pick({ match: { place: PASS } }, files)
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 15" })
    await user.click(
      within(dialog).getByRole("button", { name: "Match the rest later" })
    )
    await waitFor(() =>
      expect(started).toHaveLength(MEDIA_LIMITS.maxParallelUploads)
    )
    await slow.drain()
    await waitFor(() => expect(new Set(started).size).toBe(15))
    expect(slow.most()).toBeLessThanOrEqual(MEDIA_LIMITS.maxBatchFiles)
    // Nothing was turned away, so Add has nothing "not added" to say.
    expect(document.body.textContent).not.toMatch(/not added|at a time/)
  })

  it("11 photos matched one by one while sending is slow: the 11th is sent too", async () => {
    const slow = slowUploads()
    const files = Array.from({ length: 11 }, (_, i) => jpeg(`q${i}.jpg`, i))
    const user = await pick({ match: {} }, files)
    for (let i = 0; i < 11; i++) {
      const d = await screen.findByRole("dialog", {
        name: `Photo ${i + 1} of 11`,
      })
      await user.click(within(d).getByRole("button", { name: "Match later" }))
    }
    expect(
      await screen.findByText("11 photos are under Match later on Album.")
    ).toBeTruthy()
    // While all 11 wait, Add counts them as in progress.
    expect(addTab).toBeTruthy()
    await slow.drain()
    await waitFor(() => expect(new Set(started).size).toBe(11))
  })

  it("leaves a photo the queue would refuse in the gallery, and says why", async () => {
    const big = new File(
      [new Uint8Array(MEDIA_LIMITS.maxPhotoBytes + 1)],
      "huge.jpg",
      { type: "image/jpeg", lastModified: 1 }
    )
    await pick({ match: {} }, [big, jpeg("ok.jpg", 2)])
    const dialog = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    expect(
      within(dialog).getByText(
        "1 photo was left in your gallery. Photos can be up to 25 MB."
      )
    ).toBeTruthy()
  })

  it("a slot's one photo that the queue would refuse fills nothing", async () => {
    const empty = new File([], "empty.jpg", { type: "image/jpeg" })
    await pick(
      { slot: { kind: "dish", itemId: "item-bhaji", name: "Onion Bhaji" } },
      [empty]
    )
    expect(await screen.findByText("No slots filled")).toBeTruthy()
    expect(
      screen.getByText("1 photo was left in your gallery. This file is empty.")
    ).toBeTruthy()
    expect(started).toHaveLength(0)
  })
})

describe("should-fix 1: a failed send, then Add photos", () => {
  it("opens the queue with the failed photo, not the gallery", async () => {
    uploads.current = async (file) => {
      started.push(file.name)
      throw new Error("network down")
    }
    const user = userEvent.setup()
    albumHost(<AlbumAddTrigger kind="tab" />)
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(gallery(), [jpeg("f.jpg")])
    const d = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(
      await within(d).findByRole("button", { name: /Onion Bhaji/ })
    )
    expect(
      await screen.findByText(
        "1 photo didn't send. Choose Retry; it won't be sent twice.",
        undefined,
        { timeout: 8000 }
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Close" }))
    const click = vi.spyOn(gallery(), "click")
    await user.click(
      screen.getByRole("button", { name: /Add photos, 1 failed/ })
    )
    expect(click).not.toHaveBeenCalled()
    const queue = await screen.findByRole("dialog", { name: /Saving 1 photo/ })
    expect(within(queue).getByText("f.jpg")).toBeTruthy()
  }, 20000)

  it("still opens the gallery while Match's photos are only sending", async () => {
    slowUploads()
    const user = userEvent.setup()
    albumHost(<AlbumAddTrigger kind="tab" />)
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(gallery(), [jpeg("s.jpg")])
    const d = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await user.click(within(d).getByRole("button", { name: "Match later" }))
    await user.click(screen.getByRole("button", { name: "Close" }))
    const click = vi.spyOn(gallery(), "click")
    await user.click(
      screen.getByRole("button", { name: /Add photos, 1 in progress/ })
    )
    expect(click).toHaveBeenCalledTimes(1)
  })
})

describe("should-fix 2: Match later never needs attention", () => {
  it("even when its labels can't be read, Add is not flagged", async () => {
    // The label read gives nothing (as when it fails).
    actions.loadLabelEditorContext.mockResolvedValue(undefined)
    const user = userEvent.setup()
    albumHost(<AlbumAddTrigger kind="tab" />)
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    await user.upload(gallery(), [jpeg("a.jpg", 1), jpeg("b.jpg", 2)])
    const d = await screen.findByRole("dialog", { name: "Photo 1 of 2" })
    await user.click(within(d).getByRole("button", { name: "Match later" }))
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Match later",
      })
    )
    await user.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(started).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 200))
    expect(addTab().getAttribute("aria-label") ?? "").not.toMatch(/attention/)
    expect(document.body.textContent).not.toMatch(/needs? attention/)
  })
})

describe("should-fix 3: focus after each match", () => {
  it("goes to the next photo's title, then to the end's heading", async () => {
    const user = await pick({ match: { place: PASS } }, [
      jpeg("a.jpg", 1),
      jpeg("b.jpg", 2),
    ])
    const d = await screen.findByRole("dialog", { name: "Photo 1 of 2" })
    ;(await within(d).findByRole("button", { name: /Onion Bhaji/ })).focus()
    await user.keyboard("{Enter}")
    await screen.findByRole("dialog", { name: "Photo 2 of 2" })
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Photo 2 of 2")
    )
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Match later",
      })
    )
    const heading = await screen.findByRole("heading", {
      name: "1 slot filled",
    })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })
})

describe("nit: a double tap matches one photo only", () => {
  it("a second finger tap straight after a choice is ignored; a later one counts", async () => {
    await pick({ match: { place: PASS } }, [jpeg("a.jpg", 1), jpeg("b.jpg", 2)])
    const d = await screen.findByRole("dialog", { name: "Photo 1 of 2" })
    const tap = (el: HTMLElement) => {
      fireEvent.pointerDown(el, { pointerType: "touch" })
      fireEvent.click(el, { detail: 1 })
    }
    const now = vi.spyOn(performance, "now").mockReturnValue(1000)
    tap(await within(d).findByRole("button", { name: /Onion Bhaji/ }))
    await screen.findByRole("dialog", { name: "Photo 2 of 2" })
    // The same double tap lands on the next photo's picker.
    now.mockReturnValue(1000 + MATCH_TAP_GUARD_MS / 2)
    tap(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Match later",
      })
    )
    expect(screen.getByRole("dialog", { name: "Photo 2 of 2" })).toBeTruthy()
    // A tap of its own, later, is a choice.
    now.mockReturnValue(1000 + MATCH_TAP_GUARD_MS * 2)
    tap(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Match later",
      })
    )
    expect(await screen.findByText("1 slot filled")).toBeTruthy()
  })
})

const BHAJI_SLOT: AlbumSlot = {
  id: "dish:item-bhaji",
  name: "Onion Bhaji",
  group: "Starters",
  state: "needed",
  thumbnailUrl: null,
  neededBy: null,
  brief: null,
  target: { kind: "dish", itemId: "item-bhaji", itemName: "Onion Bhaji" },
  category: "food",
  pendingCount: 0,
  needsUpdate: false,
}

function TileOnAlbum({ slot = BHAJI_SLOT }: { slot?: AlbumSlot }) {
  const openAdd = useAdd()
  return (
    <>
      <AlbumSlotTile slot={slot} add={(opts) => openAdd?.(opts)} />
      <AlbumAddTrigger kind="bar" />
    </>
  )
}

describe("should-fix 5: Album's tiles show a slot this phone is sending", () => {
  it("Sending, then Waiting; never + Add again, and Match no longer offers it", async () => {
    const slow = slowUploads()
    const user = userEvent.setup()
    albumHost(<TileOnAlbum />)
    await user.click(
      screen.getByRole("button", { name: "Onion Bhaji: needed" })
    )
    await user.upload(gallery(), [jpeg("one.jpg")])
    expect(await screen.findByText("1 slot filled")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Close" }))
    // The tile is no longer a button: it can't be sent twice.
    const tile = await screen.findByRole("group", {
      name: "Onion Bhaji: sending",
    })
    expect(within(tile).getByText("Sending")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Onion Bhaji/ })).toBeNull()
    // Match from Add photos doesn't suggest or find it.
    await user.click(screen.getByRole("button", { name: /^Add photos/ }))
    await user.upload(gallery(), [jpeg("two.jpg", 5)])
    const d = await screen.findByRole("dialog", { name: "Photo 1 of 1" })
    await within(d).findByRole("button", { name: /Chicken Tikka/ })
    expect(within(d).queryByRole("button", { name: /Onion Bhaji/ })).toBeNull()
    await user.click(within(d).getByRole("button", { name: "Match later" }))
    await user.click(screen.getByRole("button", { name: "Close" }))
    await slow.drain()
    expect(
      await screen.findByRole("group", {
        name: "Onion Bhaji: waiting for review",
      })
    ).toBeTruthy()
  })

  it("says Saved on this phone without a signal", async () => {
    slowUploads()
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    const user = userEvent.setup()
    albumHost(<TileOnAlbum />)
    await user.click(
      screen.getByRole("button", { name: "Onion Bhaji: needed" })
    )
    await user.upload(gallery(), [jpeg("one.jpg")])
    await user.click(await screen.findByRole("button", { name: "Close" }))
    const tile = await screen.findByRole("group", {
      name: "Onion Bhaji: saved on this phone",
    })
    expect(within(tile).getByText("Saved on this phone")).toBeTruthy()
    onLine.mockRestore()
  })

  it("once the album reads the slot, a later retake shows as Retake again", async () => {
    slowUploads()
    const user = userEvent.setup()
    const view = (slot: AlbumSlot) => (
      <AddHost
        blocked={null}
        captchaRequired={false}
        captchaSiteKey={null}
        role="staff"
      >
        <TileOnAlbum slot={slot} />
      </AddHost>
    )
    const { rerender } = render(view(BHAJI_SLOT))
    await user.click(
      screen.getByRole("button", { name: "Onion Bhaji: needed" })
    )
    await user.upload(gallery(), [jpeg("one.jpg")])
    await user.click(await screen.findByRole("button", { name: "Close" }))
    await screen.findByRole("group", { name: "Onion Bhaji: sending" })
    rerender(view({ ...BHAJI_SLOT, state: "waiting" }))
    // A filled slot opens its slot page (DESIGN.md §5; S2-STAFF).
    await screen.findByRole("link", {
      name: "Onion Bhaji: waiting for review",
    })
    rerender(view({ ...BHAJI_SLOT, state: "retake" }))
    expect(
      await screen.findByRole("button", {
        name: "Onion Bhaji: needs another photo",
      })
    ).toBeTruthy()
  })

  it("a slot the album already reads as waiting shows the album's state", () => {
    albumHost(<TileOnAlbum slot={{ ...BHAJI_SLOT, state: "waiting" }} />)
    const tile = screen.getByRole("link", {
      name: "Onion Bhaji: waiting for review",
    })
    // A filled slot opens its own page (DESIGN.md §5; spec §6 S3).
    expect(tile.getAttribute("href")).toBe("/staff/album/slot/dish/item-bhaji")
  })
})
