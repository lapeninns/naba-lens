// @vitest-environment jsdom
// Labelling photos already in the Album (D21; the Open Design handoff
// "NabaLens staff photo workflow", 20 Nov 2026, design A): tick the photos,
// choose one label, read what it will do, then Save. The result names the
// folder, opens it, and can be undone.
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
  MatchLaterScreen,
  type MatchLaterPhoto,
} from "@/components/nabalens/album/match/match-later"
import type { MatchBoard } from "@/components/nabalens/album/match/model"

import { CATALOGUE } from "./labels-fixtures"

// Immediate posting (D21) is the default: pinned on here so these tests
// hold whatever the environment says.
vi.mock("@/lib/config/staff-album-posts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/staff-album-posts")>()),
  STAFF_ALBUM_POSTS: true,
}))

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

const { replace, match, area } = vi.hoisted(() => ({
  replace: vi.fn(),
  match: {
    loadMatchBoardAction: vi.fn(),
    requestLabelHelpAction: vi.fn(),
    suggestSpecialAction: vi.fn(),
  },
  area: { setAreaLabelAction: vi.fn(), loadAreaLabelsAction: vi.fn() },
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
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
  match.requestLabelHelpAction.mockResolvedValue({ ok: true })
  area.setAreaLabelAction.mockImplementation(
    async (_asset: string, subjectId: string) => ({ ok: true, subjectId })
  )
  vi.stubGlobal("fetch", vi.fn(labelApi))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Each save answers with the label's next revision, as the server does.
function revisions() {
  postAnswer = (input) => ({
    ok: true,
    assetId: input.assetId,
    state: "saved",
    labels: { revision: Number(input.expectedRevision) + 1 },
  })
}

async function tickAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Select all 2" }))
  await screen.findByText("2 photos selected")
}

describe("Label photos after posting (D21)", () => {
  it("opens ready to tick, with the count and Select all", async () => {
    render(<MatchLaterScreen photos={PHOTOS} />)
    expect(screen.getByRole("heading", { name: "Label photos" })).toBeTruthy()
    expect(
      screen.getByText(
        "Tick the photos that show the same thing, then choose one label for them."
      )
    ).toBeTruthy()
    expect(screen.getByRole("heading", { name: "To label 2" })).toBeTruthy()
    expect(screen.getAllByRole("checkbox")).toHaveLength(2)
    expect(
      screen.queryByRole("button", { name: "Label one at a time" })
    ).toBeNull()
  })

  it("saves nothing until Save, and says what Save will do", async () => {
    const user = userEvent.setup()
    revisions()
    render(<MatchLaterScreen photos={PHOTOS} />)
    await tickAll(user)
    expect(
      await screen.findByLabelText("Search dishes, drinks and spaces")
    ).toBeTruthy()
    await user.type(
      screen.getByLabelText("Search dishes, drinks and spaces"),
      "bhaji"
    )
    await user.click(await screen.findByRole("button", { name: /Onion Bhaji/ }))
    expect(posted).toHaveLength(0)
    const bar = screen.getByText("Label 2 photos as Onion Bhaji").parentElement!
    expect(
      within(bar).getByText("Album → Menu → Starters → Onion Bhaji")
    ).toBeTruthy()
    const save = within(bar).getByRole("button", { name: "Save label" })
    await waitFor(() => expect(document.activeElement).toBe(save))
    await user.click(save)
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted.map((p) => p.input.items)).toEqual([
      [{ itemId: "item-bhaji", variantId: null }],
      [{ itemId: "item-bhaji", variantId: null }],
    ])
    expect(
      await screen.findByText("2 photos labelled Onion Bhaji")
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Open folder" }).getAttribute("href")
    ).toBe("/staff/album/slot/dish/item-bhaji")
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
  })

  it("leaves without saving on Escape, and Change keeps the photos ticked", async () => {
    const user = userEvent.setup()
    render(<MatchLaterScreen photos={PHOTOS} />)
    await tickAll(user)
    await user.type(
      await screen.findByLabelText("Search dishes, drinks and spaces"),
      "bhaji"
    )
    await user.click(await screen.findByRole("button", { name: /Onion Bhaji/ }))
    await user.keyboard("{Escape}")
    expect(screen.queryByText("Label 2 photos as Onion Bhaji")).toBeNull()
    expect(screen.getByText("2 photos selected")).toBeTruthy()
    expect(posted).toHaveLength(0)
  })

  it("Undo takes the dish label off at its new revision and brings the photos back", async () => {
    const user = userEvent.setup()
    revisions()
    render(<MatchLaterScreen photos={PHOTOS} />)
    await tickAll(user)
    await user.type(
      await screen.findByLabelText("Search dishes, drinks and spaces"),
      "bhaji"
    )
    await user.click(await screen.findByRole("button", { name: /Onion Bhaji/ }))
    await user.click(screen.getByRole("button", { name: "Save label" }))
    await screen.findByText("2 photos labelled Onion Bhaji")
    posted = []
    await user.click(screen.getByRole("button", { name: "Undo" }))
    await screen.findByText(
      "Labels removed. The 2 photos are back in To label."
    )
    expect(
      posted.map((p) => [
        p.input.assetId,
        p.input.expectedRevision,
        p.input.items,
      ])
    ).toEqual([
      [A1, 1, []],
      [A2, 3, []],
    ])
    expect(screen.getAllByRole("checkbox")).toHaveLength(2)
  })

  it("files a space under Spaces, and Undo clears its area", async () => {
    const user = userEvent.setup()
    render(<MatchLaterScreen photos={PHOTOS} />)
    await tickAll(user)
    await user.type(
      await screen.findByLabelText("Search dishes, drinks and spaces"),
      "garden"
    )
    await user.click(await screen.findByRole("button", { name: /The garden/ }))
    expect(screen.getByText("Album → Spaces → The garden")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Save label" }))
    await screen.findByText("2 photos labelled The garden")
    await user.click(screen.getByRole("button", { name: "Undo" }))
    await screen.findByText(
      "Labels removed. The 2 photos are back in To label."
    )
    expect(area.setAreaLabelAction).toHaveBeenCalledWith(A1, null)
    expect(area.setAreaLabelAction).toHaveBeenCalledWith(A2, null)
  })

  it("says so and keeps the label when Undo fails", async () => {
    const user = userEvent.setup()
    render(<MatchLaterScreen photos={PHOTOS} />)
    await tickAll(user)
    await user.type(
      await screen.findByLabelText("Search dishes, drinks and spaces"),
      "garden"
    )
    await user.click(await screen.findByRole("button", { name: /The garden/ }))
    await user.click(screen.getByRole("button", { name: "Save label" }))
    await screen.findByText("2 photos labelled The garden")
    area.setAreaLabelAction.mockResolvedValue({ ok: false, message: "No" })
    await user.click(screen.getByRole("button", { name: "Undo" }))
    expect(
      await screen.findByText("The label could not be removed. Try again.")
    ).toBeTruthy()
    expect(screen.getByText("2 photos labelled The garden")).toBeTruthy()
  })

  it("sends a photo to the manager with the words searched for, and says so (AC03)", async () => {
    const user = userEvent.setup()
    render(<MatchLaterScreen photos={PHOTOS} />)
    await user.click(screen.getByRole("checkbox", { name: "Select photo 1" }))
    await user.type(
      await screen.findByLabelText("Search dishes, drinks and spaces"),
      "lamb shank"
    )
    await user.click(
      await screen.findByRole("button", {
        name: /^Ask my manager about “lamb shank”/,
      })
    )
    await waitFor(() =>
      expect(match.requestLabelHelpAction).toHaveBeenCalledWith(A1)
    )
    // The note goes first, with no label.
    expect(posted).toHaveLength(1)
    expect(posted[0]!.input).toMatchObject({
      assetId: A1,
      note: "lamb shank",
      items: [],
      contentTypes: [],
    })
    expect(
      await screen.findByText(
        "1 photo is with your manager, who will choose its label."
      )
    ).toBeTruthy()
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
  })

  it("retries a failed handoff with the revision the note save returned", async () => {
    const user = userEvent.setup()
    revisions()
    match.requestLabelHelpAction.mockResolvedValueOnce({
      ok: false,
      message: "Connection lost",
    })
    render(<MatchLaterScreen photos={PHOTOS} />)
    await user.click(screen.getByRole("checkbox", { name: "Select photo 1" }))
    await user.type(
      await screen.findByLabelText("Search dishes, drinks and spaces"),
      "lamb shank"
    )
    const ask = await screen.findByRole("button", {
      name: /^Ask my manager about “lamb shank”/,
    })
    await user.click(ask)
    expect(await screen.findByText("Connection lost")).toBeTruthy()
    // The photo stays ticked; only the search is typed again.
    const search = await screen.findByLabelText(
      "Search dishes, drinks and spaces"
    )
    await user.clear(search)
    await user.type(search, "lamb shank")
    await user.click(
      await screen.findByRole("button", {
        name: /^Ask my manager about “lamb shank”/,
      })
    )
    await waitFor(() =>
      expect(match.requestLabelHelpAction).toHaveBeenCalledTimes(2)
    )
    // The first note save took revision 0 to 1; the retry must send 1.
    expect(posted.map((p) => p.input.expectedRevision)).toEqual([0, 1])
  })
})
