// @vitest-environment jsdom
// Match later (DESIGN.md §2.8, §5a step 5; Album AL-1): the row on Album
// with the number of unmatched photos, and the screen that matches them one
// at a time: a dish saves its menu label, an area its venue-area label, Not
// for a slot what the photo shows. A matched photo leaves the list.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  MATCH_LATER_HREF,
  MatchLaterRow,
  MatchLaterScreen,
  type MatchLaterPhoto,
} from "@/components/nabalens/album/match/match-later"
import type { MatchBoard } from "@/components/nabalens/album/match/model"

import { CATALOGUE } from "./labels-fixtures"

const GARDEN = "00000000-0000-4000-8000-00000000b003"
const PASS = "00000000-0000-4000-8000-00000000b002"
const A1 = "00000000-0000-4000-8000-0000000a0001"
const A2 = "00000000-0000-4000-8000-0000000a0002"

const BOARD: MatchBoard = {
  slots: [
    {
      id: "dish:item-bhaji",
      name: "Onion Bhaji",
      group: "Starters",
      place: PASS,
      placeLabel: "Kitchen pass",
      brief: null,
      target: { kind: "dish", itemId: "item-bhaji", name: "Onion Bhaji" },
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
  amenities: [],
}

const { refresh, match, area } = vi.hoisted(() => ({
  refresh: vi.fn(),
  match: { loadMatchBoardAction: vi.fn() },
  area: { setAreaLabelAction: vi.fn(), loadAreaLabelsAction: vi.fn() },
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}))
vi.mock("@/app/staff/_shell/match-actions", () => match)
vi.mock("@/app/_labels/area-actions", () => area)

let posted: { venueId: string; input: Record<string, unknown> }[] = []
let postAnswer: ((input: Record<string, unknown>) => unknown) | null = null
function labelApi(_url: string, init?: RequestInit) {
  let body: unknown
  if (init?.method === "POST") {
    const sent = JSON.parse(String(init.body))
    posted.push(sent)
    body = postAnswer?.(sent.input) ?? {
      ok: true,
      assetId: sent.input.assetId,
      state: "saved",
      labels: {},
    }
  } else body = { ok: true, catalogue: CATALOGUE, focus: null }
  return Promise.resolve({ json: async () => body } as Response)
}

const PHOTOS: MatchLaterPhoto[] = [
  {
    id: A1,
    thumbnailUrl: "https://example.test/a1.jpg",
    createdAt: "2026-11-17T10:00:00Z",
    revision: 0,
  },
  {
    id: A2,
    thumbnailUrl: "https://example.test/a2.jpg",
    createdAt: "2026-11-17T09:00:00Z",
    revision: 2,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  posted = []
  postAnswer = null
  match.loadMatchBoardAction.mockResolvedValue({ ok: true, board: BOARD })
  area.setAreaLabelAction.mockImplementation(
    async (_asset: string, subjectId: string) => ({ ok: true, subjectId })
  )
  vi.stubGlobal("fetch", vi.fn(labelApi))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("MatchLaterRow", () => {
  it("shows nothing when every photo is matched", () => {
    const { container } = render(<MatchLaterRow count={0} />)
    expect(container.textContent).toBe("")
  })

  it("names the count and links to Match later", () => {
    render(<MatchLaterRow count={3} />)
    const link = screen.getByRole("link", { name: /Match later/ })
    expect(link.getAttribute("href")).toBe(MATCH_LATER_HREF)
    expect(link.textContent).toContain("3 photos to match")
    render(<MatchLaterRow count={1} href="/x" />)
    expect(screen.getByText("1 photo to match")).toBeTruthy()
  })
})

describe("MatchLaterScreen", () => {
  it("matches a dish: the menu label is saved at the photo's revision and it leaves the list", async () => {
    const user = userEvent.setup()
    render(<MatchLaterScreen photos={PHOTOS} />)
    expect(
      screen.getByRole("heading", { level: 1, name: "Match later" })
    ).toBeTruthy()
    expect(screen.getByText("2 photos to match")).toBeTruthy()
    expect(screen.getByRole("img", { name: "Photo 1 of 2" })).toBeTruthy()
    await user.click(await screen.findByRole("button", { name: /Onion Bhaji/ }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({
      venueId: "venue-1",
      input: expect.objectContaining({
        assetId: A1,
        expectedRevision: 0,
        catalogueVersionId: "version-1",
        items: [{ itemId: "item-bhaji", variantId: null }],
        contentTypes: [],
      }),
    })
    expect(await screen.findByText("1 photo to match")).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
    // The filled slot is not offered for the next photo.
    expect(screen.queryByRole("button", { name: /Onion Bhaji/ })).toBeNull()
  })

  it("matches an area with its venue-area label", async () => {
    const user = userEvent.setup()
    render(<MatchLaterScreen photos={[PHOTOS[1]]} />)
    await user.type(
      await screen.findByRole("searchbox", { name: "Search all empty slots" }),
      "garden"
    )
    await user.click(screen.getByRole("button", { name: /The garden/ }))
    await waitFor(() =>
      expect(area.setAreaLabelAction).toHaveBeenCalledWith(A2, GARDEN)
    )
    expect(
      await screen.findByText("Every photo you added is matched to a slot.")
    ).toBeTruthy()
    expect(posted).toEqual([])
  })

  it("Not for a slot saves what the photo shows", async () => {
    const user = userEvent.setup()
    render(<MatchLaterScreen photos={[PHOTOS[1]]} />)
    await user.click(screen.getByRole("button", { name: "Not for a slot" }))
    await user.click(screen.getByRole("button", { name: "Kitchen" }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].input).toEqual(
      expect.objectContaining({
        assetId: A2,
        expectedRevision: 2,
        items: [],
        contentTypes: ["kitchen"],
      })
    )
    // Match later is not offered on Match later itself.
    expect(screen.queryByRole("button", { name: "Match later" })).toBeNull()
  })

  it("keeps the photo and says so when the save is refused", async () => {
    postAnswer = (input) => ({
      ok: false,
      assetId: input.assetId,
      code: "conflict",
      message: "These labels changed elsewhere. Try again.",
    })
    const user = userEvent.setup()
    render(<MatchLaterScreen photos={PHOTOS} />)
    await user.click(await screen.findByRole("button", { name: /Onion Bhaji/ }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "These labels changed elsewhere. Try again."
    )
    expect(screen.getByText("2 photos to match")).toBeTruthy()
  })

  it("lets the person choose which photo from the strip, by name", async () => {
    const user = userEvent.setup()
    render(<MatchLaterScreen photos={PHOTOS} />)
    const strip = screen.getByRole("list", { name: "Match later" })
    const second = within(strip).getByRole("button", { name: "Photo 2 of 2" })
    await user.click(second)
    expect(second.getAttribute("aria-current")).toBe("true")
    expect(screen.getByRole("img", { name: "Photo 2 of 2" })).toBeTruthy()
  })

  it("says when nothing waits", () => {
    render(<MatchLaterScreen photos={[]} />)
    expect(
      screen.getByText("Every photo you added is matched to a slot.")
    ).toBeTruthy()
  })
})
