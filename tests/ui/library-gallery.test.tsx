// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { filtersToSearch } from "@/app/admin/library-search"
import { MediaGallery, type LoadPage } from "@/app/_media/media-gallery"
import { parseMediaRoute, versioned } from "@/app/_media/preview-recovery"
import {
  EMPTY_LIBRARY_FILTERS,
  type LibraryFilterValue,
} from "@/components/nabalens"
import { parseLibraryFilters } from "@/lib/server/media/library"
import type { MediaItemView } from "@/lib/server/media/types"

// The gallery's delete Server Function pulls in server-only modules.
vi.mock("@/app/_media/actions", () => ({
  deleteMedia: vi.fn(async () => ({ ok: true })),
}))

const ID_A = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01"
const ID_B = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a02"
const VENUE = "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11"
const STAFF = "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22"

function item(id: string, overrides: Partial<MediaItemView> = {}) {
  return {
    id,
    mediaType: "image",
    uploadState: "ready",
    thumbnailUrl: `/api/media/${id}/thumb`,
    previewUrl: `/api/media/${id}/preview`,
    mimeType: "image/jpeg",
    originalFilename: `${id.slice(-2)}.jpg`,
    createdAt: "2026-10-29T12:00:00.000000+00:00",
    contributorId: STAFF,
    contributorName: "TEST Staff",
    venueName: "TEST Venue",
    width: 64,
    height: 48,
    durationSeconds: null,
    sizeBytes: 4,
    ...overrides,
  } satisfies MediaItemView
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("library URL params", () => {
  it("round-trip every filter combination through the URL", () => {
    const venues = [null, VENUE]
    const staff = [null, STAFF]
    const types = ["all", "image", "video"] as const
    for (const venueId of venues)
      for (const staffId of staff)
        for (const type of types) {
          const value: LibraryFilterValue = { venueId, staffId, type }
          const search = filtersToSearch(value)
          const params = Object.fromEntries(new URLSearchParams(search))
          const back = parseLibraryFilters(params)
          expect({ ...back, type: back.type ?? "all" }).toEqual(value)
        }
    // Cleared filters give a bare URL.
    expect(filtersToSearch(EMPTY_LIBRARY_FILTERS)).toBe("")
  })

  it("drops invalid or repeated params instead of passing them to the query", () => {
    expect(
      parseLibraryFilters({
        venue: "not-a-uuid",
        staff: `${STAFF}),or(id.gt.0`,
        type: "document",
      })
    ).toEqual({ venueId: null, staffId: null, type: null })
    expect(
      parseLibraryFilters({ venue: [VENUE, "x"], staff: [], type: ["video"] })
    ).toEqual({ venueId: VENUE, staffId: null, type: "video" })
  })
})

describe("preview route URLs", () => {
  it("parses gallery media routes, absolute or with a re-sign marker", () => {
    expect(parseMediaRoute(`/api/media/${ID_A}/thumb`)).toEqual({
      id: ID_A,
      slot: "thumb",
    })
    expect(
      parseMediaRoute(`http://127.0.0.1:3000/api/media/${ID_A}/stream?r=2`)
    ).toEqual({ id: ID_A, slot: "stream" })
    expect(parseMediaRoute(`/api/media/${ID_A}/download`)).toBeNull()
    expect(parseMediaRoute("https://storage.example/x/thumb")).toBeNull()
    expect(parseMediaRoute(null)).toBeNull()
    expect(versioned("/api/media/x/thumb", 0)).toBe("/api/media/x/thumb")
    expect(versioned("/api/media/x/thumb", 2)).toBe("/api/media/x/thumb?r=2")
  })
})

function renderGallery(loadPage: LoadPage, refreshIntervalMs?: number) {
  return render(
    <MediaGallery
      label="Library"
      initialPage={{ items: [item(ID_A), item(ID_B)], nextCursor: null }}
      loadPage={loadPage}
      empty={<p>Empty</p>}
      refreshIntervalMs={refreshIntervalMs}
    />
  )
}

const thumbOf = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLImageElement>(`img[src^="/api/media/${id}/"]`)

describe("signed-URL recovery", () => {
  it("re-requests a failed thumbnail once, then shows a visible error", async () => {
    const loadPage = vi.fn<LoadPage>()
    const { container } = renderGallery(loadPage)
    expect(screen.queryByRole("alert")).toBeNull()

    // First failure (e.g. an expired link): same route, fresh signature.
    fireEvent.error(thumbOf(container, ID_A)!)
    expect(thumbOf(container, ID_A)!.getAttribute("src")).toBe(
      `/api/media/${ID_A}/thumb?r=1`
    )
    expect(screen.queryByRole("alert")).toBeNull()

    // Second failure: no further automatic request, a visible error instead.
    fireEvent.error(thumbOf(container, ID_A)!)
    expect(thumbOf(container, ID_A)).toBeNull()
    expect(screen.getByRole("alert").textContent).toContain(
      "1 preview could not load."
    )
    // The other tile is untouched.
    expect(thumbOf(container, ID_B)!.getAttribute("src")).toBe(
      `/api/media/${ID_B}/thumb`
    )

    // Try again: one fresh attempt.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(thumbOf(container, ID_A)!.getAttribute("src")).toBe(
      `/api/media/${ID_A}/thumb?r=2`
    )
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.error(thumbOf(container, ID_A)!)
    expect(screen.getByRole("alert")).toBeTruthy()
    expect(loadPage).not.toHaveBeenCalled()
  })

  it("recovers the viewer's preview the same way", async () => {
    const { container } = renderGallery(vi.fn<LoadPage>())
    fireEvent.click(screen.getByRole("button", { name: /^Photo, 01\.jpg/ }))
    const dialog = await screen.findByRole("dialog")
    const preview = () =>
      dialog.querySelector<HTMLImageElement>(`img[src^="/api/media/${ID_A}/"]`)
    expect(preview()!.getAttribute("src")).toBe(`/api/media/${ID_A}/preview`)
    fireEvent.error(preview()!)
    expect(preview()!.getAttribute("src")).toBe(
      `/api/media/${ID_A}/preview?r=1`
    )
    fireEvent.error(preview()!)
    expect(preview()).toBeNull()
    expect(dialog.textContent).toContain("Preview unavailable")
    expect(container.ownerDocument.body.textContent).toContain(
      "1 preview could not load."
    )
  })

  it("gives broken previews a fresh attempt on the next refresh", async () => {
    const loadPage = vi.fn<LoadPage>(async () => ({
      ok: true,
      page: { items: [item(ID_A), item(ID_B)], nextCursor: null },
    }))
    const { container } = renderGallery(loadPage)
    fireEvent.error(thumbOf(container, ID_A)!)
    fireEvent.error(thumbOf(container, ID_A)!)
    expect(screen.getByRole("alert")).toBeTruthy()

    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(loadPage).toHaveBeenCalledWith(null)
    expect(thumbOf(container, ID_A)!.getAttribute("src")).toBe(
      `/api/media/${ID_A}/thumb?r=2`
    )
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("foreground refresh", () => {
  let visibility: DocumentVisibilityState
  beforeEach(() => {
    visibility = "visible"
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility
    )
  })

  async function setVisibility(next: DocumentVisibilityState) {
    visibility = next
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
  }

  it("refreshes every 15 s while visible, pauses while hidden, and fires on focus", async () => {
    vi.useFakeTimers()
    const newer = item("0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a03", {
      createdAt: "2026-10-29T12:05:00.000000+00:00",
    })
    let first = [item(ID_A), item(ID_B)]
    const loadPage = vi.fn<LoadPage>(async () => ({
      ok: true,
      page: { items: first, nextCursor: null },
    }))
    renderGallery(loadPage, 15_000)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999)
    })
    expect(loadPage).toHaveBeenCalledTimes(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(loadPage).toHaveBeenCalledTimes(1)
    expect(loadPage).toHaveBeenLastCalledWith(null)

    // Hidden: a minute passes with no requests.
    await setVisibility("hidden")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(loadPage).toHaveBeenCalledTimes(1)

    // A new upload arrives meanwhile; returning to the tab shows it at once.
    first = [newer, item(ID_A), item(ID_B)]
    await setVisibility("visible")
    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(
      screen
        .getAllByRole("button", { name: /^Photo, / })[0]
        .getAttribute("aria-label")
    ).toMatch(/^Photo, 03\.jpg/)

    // Window focus (e.g. switching back from another app) refreshes too.
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(loadPage).toHaveBeenCalledTimes(3)

    // And the interval resumes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(loadPage).toHaveBeenCalledTimes(4)
  })

  it("does not poll without an interval (staff portfolio, nothing processing)", async () => {
    vi.useFakeTimers()
    const loadPage = vi.fn<LoadPage>()
    renderGallery(loadPage)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(loadPage).not.toHaveBeenCalled()
  })
})
