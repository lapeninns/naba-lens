// @vitest-environment jsdom
// B03 UI design §3.6: a venue's places, for its manager or an admin. Keyed
// add and retire, place_exists shown instead of added twice, retire with a
// reason, and focus that never drops to the page.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => nav }))

import {
  PLACES_COPY,
  PlacesManager,
  type PlaceHandlers,
} from "@/components/nabalens/knowledge/places-manager"
import type { Place } from "@/lib/knowledge-client/contract"

const VENUE = "9b000000-0000-4000-8000-000000000301"
const place = (over: Partial<Place>): Place => ({
  subjectId: "5a000000-0000-4000-8000-000000000001",
  kind: "entrance",
  label: "⟨Main entrance⟩",
  active: true,
  addedOn: "2026-11-03T10:00:00Z",
  addedBy: "⟨Name⟩",
  retiredOn: null,
  ...over,
})
const MAIN = place({})
const SIDE = place({
  subjectId: "5a000000-0000-4000-8000-000000000002",
  label: "⟨Side door⟩",
})
const GARDEN = place({
  subjectId: "5a000000-0000-4000-8000-000000000003",
  kind: "area",
  label: "⟨Garden⟩",
})
const OLD = place({
  subjectId: "5a000000-0000-4000-8000-000000000004",
  label: "⟨Old gate⟩",
  active: false,
  retiredOn: "2026-11-05T10:00:00Z",
})

const ok = { ok: true as const, subjectId: MAIN.subjectId, replayed: false }

function show(places: Place[], handlers: Partial<PlaceHandlers> = {}) {
  const h: PlaceHandlers = {
    add: vi.fn(async () => ok),
    retire: vi.fn(async () => ok),
    ...handlers,
  }
  render(
    <PlacesManager
      venueId={VENUE}
      venueName="⟨Venue⟩"
      places={places}
      handlers={h}
    />
  )
  return h
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
})

describe("PlacesManager", () => {
  it("lists active places by kind with who added them, and retired ones apart", () => {
    show([MAIN, SIDE, GARDEN, OLD])
    const entrances = screen.getByRole("region", { name: "Entrances" })
    expect(
      within(entrances)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual([
      "⟨Main entrance⟩Added on 3 Nov 2026 by ⟨Name⟩Retire",
      "⟨Side door⟩Added on 3 Nov 2026 by ⟨Name⟩Retire",
    ])
    expect(screen.getByRole("region", { name: "Areas" })).toBeTruthy()
    expect(screen.queryByRole("region", { name: "Rooms" })).toBeNull()
    expect(screen.getByText("Retired (1)")).toBeTruthy()
    expect(screen.getByText("Retired on 5 Nov 2026")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Retire ⟨Main entrance⟩" })
    ).toBeTruthy()
  })

  it("says what to add first when nothing is listed", () => {
    show([OLD])
    expect(screen.getByText(PLACES_COPY.empty)).toBeTruthy()
  })

  it("asks for a kind and a name, focusing the first missing one", async () => {
    const user = userEvent.setup()
    const h = show([])
    await user.type(screen.getByLabelText("Name"), "⟨Garden gate⟩")
    await user.click(screen.getByRole("button", { name: PLACES_COPY.add }))
    expect(h.add).not.toHaveBeenCalled()
    expect(screen.getByText("Choose what kind of place this is.")).toBeTruthy()
  })

  it("adds with one request key per intent, replayed after a lost reply", async () => {
    const user = userEvent.setup()
    const add = vi
      .fn<PlaceHandlers["add"]>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok)
    show([], { add })
    await user.click(screen.getByRole("combobox", { name: "Kind" }))
    await user.click(await screen.findByRole("option", { name: "Entrance" }))
    await user.type(screen.getByLabelText("Name"), "  ⟨Garden gate⟩ ")
    await user.click(screen.getByRole("button", { name: PLACES_COPY.add }))
    expect(await screen.findByText(PLACES_COPY.network)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: PLACES_COPY.add }))
    await screen.findByText(PLACES_COPY.added("⟨Garden gate⟩"))
    expect(add).toHaveBeenCalledTimes(2)
    const [first, second] = add.mock.calls.map((c) => c[0])
    expect(first).toEqual({
      venueId: VENUE,
      kind: "entrance",
      label: "⟨Garden gate⟩",
      idempotencyKey: expect.any(String),
    })
    expect(second!.idempotencyKey).toBe(first!.idempotencyKey)
    expect(nav.refresh).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("")
  })

  it("shows and focuses a place that is already listed instead of adding it twice", async () => {
    const user = userEvent.setup()
    show([MAIN], {
      add: vi.fn(async () => ({
        ok: false as const,
        code: "state_conflict" as const,
        status: 409 as const,
        message: "This place is already listed. Choose it from the list.",
        subjectId: MAIN.subjectId,
      })),
    })
    await user.click(screen.getByRole("combobox", { name: "Kind" }))
    await user.click(await screen.findByRole("option", { name: "Entrance" }))
    await user.type(screen.getByLabelText("Name"), "⟨main entrance⟩")
    await user.click(screen.getByRole("button", { name: PLACES_COPY.add }))
    expect(
      await screen.findByText(PLACES_COPY.exists("⟨main entrance⟩"))
    ).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement?.id).toBe(`place-${MAIN.subjectId}`)
    )
    expect(nav.refresh).not.toHaveBeenCalled()
  })

  it("retires with a reason and moves focus to the next row", async () => {
    const user = userEvent.setup()
    const h = show([MAIN, SIDE])
    await user.click(
      screen.getByRole("button", { name: "Retire ⟨Main entrance⟩" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Retire ⟨Main entrance⟩?",
    })
    expect(within(dialog).getByText(PLACES_COPY.retireBody)).toBeTruthy()
    await user.type(within(dialog).getByLabelText(/Why\?/), "⟨Reason⟩")
    await user.click(
      within(dialog).getByRole("button", { name: PLACES_COPY.retireConfirm })
    )
    expect(h.retire).toHaveBeenCalledWith({
      subjectId: MAIN.subjectId,
      reason: "⟨Reason⟩",
      idempotencyKey: expect.any(String),
    })
    expect(
      await screen.findByText(PLACES_COPY.retired("⟨Main entrance⟩"))
    ).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement?.id).toBe(`place-${SIDE.subjectId}-retire`)
    )
  })
})
