// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { filtersToSearch } from "@/app/admin/library-search"
import {
  MediaGallery,
  REFRESH_TIMEOUT_MS,
  type LoadPage,
  type RefreshPage,
} from "@/app/_media/media-gallery"
import {
  parseMediaRoute,
  usePreviewRecovery,
  versioned,
} from "@/app/_media/preview-recovery"
import {
  EMPTY_LIBRARY_FILTERS,
  type LibraryFilterValue,
} from "@/components/nabalens"
import { parseLibraryFilters } from "@/lib/server/media/library"
import type { MediaItemView } from "@/lib/server/media/types"

// lib/server/media/library loads label summaries from a server-only module.
vi.mock("server-only", () => ({}))
// The gallery's delete Server Function pulls in server-only modules.
vi.mock("@/app/_media/actions", () => ({
  deleteMedia: vi.fn(async () => ({ ok: true })),
}))
// So do the v0.3 label editor's Server Functions (hosted by the gallery).
vi.mock("@/app/_labels/actions", () => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
  saveLabelBatch: vi.fn(),
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
    labels: null,
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
          const value: LibraryFilterValue = {
            ...EMPTY_LIBRARY_FILTERS,
            venueId,
            staffId,
            type,
          }
          const search = filtersToSearch(value)
          const params = Object.fromEntries(new URLSearchParams(search))
          const back = parseLibraryFilters(params)
          expect({ ...back, type: back.type ?? "all" }).toEqual(value)
        }
    // Cleared filters give a bare URL.
    expect(filtersToSearch(EMPTY_LIBRARY_FILTERS)).toBe("")
  })

  it("round-trips the label filters in one fixed param order", () => {
    const value: LibraryFilterValue = {
      venueId: VENUE,
      staffId: STAFF,
      type: "video",
      itemId: ID_A,
      variantId: ID_B,
      category: "curries",
      contentType: "plating",
      labelState: "labelled",
      query: "lamb bhuna",
      from: "2026-10-01",
      to: "2026-10-31",
    }
    const search = filtersToSearch(value)
    expect([...new URLSearchParams(search).keys()]).toEqual([
      "venue",
      "staff",
      "type",
      "item",
      "variant",
      "category",
      "content",
      "labels",
      "q",
      "from",
      "to",
    ])
    expect(
      parseLibraryFilters(Object.fromEntries(new URLSearchParams(search)))
    ).toEqual(value)
  })

  it("drops invalid or repeated params instead of passing them to the query", () => {
    expect(
      parseLibraryFilters({
        venue: "not-a-uuid",
        staff: `${STAFF}),or(id.gt.0`,
        type: "document",
      })
    ).toEqual({
      ...EMPTY_LIBRARY_FILTERS,
      venueId: null,
      staffId: null,
      type: null,
    })
    expect(
      parseLibraryFilters({ venue: [VENUE, "x"], staff: [], type: ["video"] })
    ).toEqual({ ...EMPTY_LIBRARY_FILTERS, venueId: VENUE, type: "video" })
  })
})

describe("preview route URLs", () => {
  it("parses gallery media routes, absolute or with a re-sign marker", () => {
    expect(parseMediaRoute(`/api/media/${ID_A}/thumb`)).toEqual({
      id: ID_A,
      slot: "thumb",
      version: 0,
    })
    expect(
      parseMediaRoute(`http://127.0.0.1:3000/api/media/${ID_A}/stream?r=2`)
    ).toEqual({ id: ID_A, slot: "stream", version: 2 })
    expect(parseMediaRoute(`/api/media/${ID_A}/download`)).toBeNull()
    expect(parseMediaRoute("https://storage.example/x/thumb")).toBeNull()
    expect(parseMediaRoute(null)).toBeNull()
    expect(versioned("/api/media/x/thumb", 0)).toBe("/api/media/x/thumb")
    expect(versioned("/api/media/x/thumb", 2)).toBe("/api/media/x/thumb?r=2")
  })
})

function renderGallery(
  loadPage: LoadPage,
  refreshIntervalMs?: number,
  getDownloadHref?: (item: { id: string }) => string,
  refreshPage?: RefreshPage
) {
  return render(
    <MediaGallery
      label="Library"
      initialPage={{ items: [item(ID_A), item(ID_B)], nextCursor: null }}
      loadPage={loadPage}
      refreshPage={refreshPage}
      empty={<p>Empty</p>}
      refreshIntervalMs={refreshIntervalMs}
      getDownloadHref={getDownloadHref}
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

  it("also recovers an image that failed before hydration (no error event)", () => {
    // The server-rendered <img> for A already failed: complete, no pixels.
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockImplementation(
      function (this: HTMLImageElement) {
        return this.getAttribute("src") === `/api/media/${ID_A}/thumb`
      }
    )
    const { container } = renderGallery(vi.fn<LoadPage>())
    expect(thumbOf(container, ID_A)!.getAttribute("src")).toBe(
      `/api/media/${ID_A}/thumb?r=1`
    )
    expect(thumbOf(container, ID_B)!.getAttribute("src")).toBe(
      `/api/media/${ID_B}/thumb`
    )
    vi.restoreAllMocks()
  })

  it("counts each URL version once (mount scan + a late event, or a stale URL)", () => {
    const { result } = renderHook(() => usePreviewRecovery([item(ID_A)]))
    const errorFrom = (src: string) => {
      const img = document.createElement("img")
      img.setAttribute("src", src)
      act(() => {
        result.current.onError({
          target: img,
        } as unknown as React.SyntheticEvent<HTMLElement>)
      })
    }
    const thumb = () => result.current.display[0].thumbnailUrl
    errorFrom(`/api/media/${ID_A}/thumb`)
    expect(thumb()).toBe(`/api/media/${ID_A}/thumb?r=1`)
    // The same first failure reported again: ignored, no broken state.
    errorFrom(`/api/media/${ID_A}/thumb`)
    expect(result.current.brokenCount).toBe(0)
    expect(thumb()).toBe(`/api/media/${ID_A}/thumb?r=1`)
    // The re-signed URL failing is the second failure.
    errorFrom(`/api/media/${ID_A}/thumb?r=1`)
    expect(result.current.brokenCount).toBe(1)
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

  function feed(count: number) {
    return Array.from({ length: count }, (_, index) =>
      item(
        `00000000-0000-4000-8000-${String(count - index).padStart(12, "0")}`,
        {
          originalFilename: `photo-${index}.jpg`,
        }
      )
    )
  }

  function feedPage(all: MediaItemView[], start: number) {
    const end = start + 24
    return {
      items: all.slice(start, end),
      nextCursor: end < all.length ? `offset:${end}` : null,
    }
  }

  it("keeps every upload reachable when more than a page arrives after all pages were loaded", async () => {
    const all = feed(78)
    const loadPage = vi.fn<LoadPage>(async (cursor) => ({
      ok: true,
      page: feedPage(all, Number(cursor?.split(":")[1])),
    }))
    const refreshPage = vi.fn<RefreshPage>(async (_signal, cursor) => ({
      ok: true,
      page: feedPage(all, cursor ? Number(cursor.split(":")[1]) : 0),
    }))
    render(
      <MediaGallery
        label="Library"
        initialPage={feedPage(all, 30)}
        loadPage={loadPage}
        refreshPage={refreshPage}
        empty={<p>Empty</p>}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    })
    expect(screen.getAllByRole("button", { name: /^Photo, / })).toHaveLength(48)
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()

    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    // Read through the old end of the range, retaining both old and new files.
    const tiles = screen.getAllByRole("button", { name: /^Photo, / })
    expect(tiles).toHaveLength(78)
    expect(
      new Set(tiles.map((tile) => tile.getAttribute("aria-label"))).size
    ).toBe(78)
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
  })

  it("preserves loaded page depth and advances its cursor during refresh", async () => {
    const all = feed(54)
    const loadPage = vi.fn<LoadPage>(async (cursor) => ({
      ok: true,
      page: feedPage(all, Number(cursor?.split(":")[1])),
    }))
    const refreshPage = vi.fn<RefreshPage>(async (_signal, cursor) => ({
      ok: true,
      page: feedPage(all, cursor ? Number(cursor.split(":")[1]) : 0),
    }))
    render(
      <MediaGallery
        label="Library"
        initialPage={feedPage(all, 6)}
        loadPage={loadPage}
        refreshPage={refreshPage}
        empty={<p>Empty</p>}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    })
    expect(screen.getAllByRole("button", { name: /^Photo, / })).toHaveLength(48)
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(screen.getAllByRole("button", { name: /^Photo, / })).toHaveLength(54)
    expect(loadPage).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
  })

  it("updates older pending files and removes older deleted files without dropping loaded pages", async () => {
    const all = feed(48)
    const pending = {
      ...all[30],
      uploadState: "processing" as const,
      thumbnailUrl: null,
    }
    const old = all.map((i) => (i.id === pending.id ? pending : i))
    const current = all.filter((i) => i.id !== all[31].id)
    const loadPage = vi.fn<LoadPage>(async () => ({
      ok: true,
      page: feedPage(old, 24),
    }))
    const refreshPage = vi.fn<RefreshPage>(async (_signal, cursor) => ({
      ok: true,
      page: feedPage(current, cursor ? Number(cursor.split(":")[1]) : 0),
    }))
    const { container } = render(
      <MediaGallery
        label="Library"
        initialPage={feedPage(old, 0)}
        loadPage={loadPage}
        refreshPage={refreshPage}
        empty={<p>Empty</p>}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    })
    expect(
      screen
        .getByRole("button", { name: /^Photo, photo-30\.jpg/ })
        .getAttribute("aria-label")
    ).toContain("Processing")
    expect(thumbOf(container, pending.id)).toBeNull()
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(screen.getAllByRole("button", { name: /^Photo, / })).toHaveLength(47)
    expect(
      screen
        .getByRole("button", { name: /^Photo, photo-30\.jpg/ })
        .getAttribute("aria-label")
    ).not.toContain("Processing")
    expect(thumbOf(container, pending.id)).not.toBeNull()
    expect(
      screen.queryByRole("button", { name: /^Photo, photo-31\.jpg/ })
    ).toBeNull()
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
    expect(refreshPage).toHaveBeenCalledTimes(2)
  })

  it("preserves a deep open viewer and loaded range when new uploads arrive", async () => {
    const all = feed(216)
    const loadPage = vi.fn<LoadPage>(async (cursor) => ({
      ok: true,
      page: feedPage(all, Number(cursor?.split(":")[1])),
    }))
    const refreshPage = vi.fn<RefreshPage>(async (_signal, cursor) => ({
      ok: true,
      page: feedPage(all, cursor ? Number(cursor.split(":")[1]) : 0),
    }))
    const { container } = render(
      <MediaGallery
        label="Library"
        initialPage={feedPage(all, 24)}
        loadPage={loadPage}
        refreshPage={refreshPage}
        empty={<p>Empty</p>}
      />
    )
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Load more" }))
      })
    }
    fireEvent.click(
      screen.getByRole("button", { name: /^Photo, photo-170\.jpg/ })
    )
    expect(screen.getByRole("dialog").textContent).toContain("photo-170.jpg")
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(refreshPage).toHaveBeenCalledTimes(8)
    expect(
      container.querySelectorAll("button[aria-label^='Photo, ']")
    ).toHaveLength(192)
    expect(screen.getByRole("dialog").textContent).toContain("photo-170.jpg")
  })

  it("stops after crossing a deleted oldest item's sort boundary", async () => {
    const all = feed(72)
    const current = all.filter((i) => i.id !== all[47].id)
    const loadPage = vi.fn<LoadPage>(async () => ({
      ok: true,
      page: feedPage(all, 24),
    }))
    const refreshPage = vi.fn<RefreshPage>(async (_signal, cursor) => ({
      ok: true,
      page: feedPage(current, cursor ? Number(cursor.split(":")[1]) : 0),
    }))
    render(
      <MediaGallery
        label="Library"
        initialPage={feedPage(all, 0)}
        loadPage={loadPage}
        refreshPage={refreshPage}
        empty={<p>Empty</p>}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    })
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(refreshPage).toHaveBeenCalledTimes(2)
    expect(screen.getAllByRole("button", { name: /^Photo, / })).toHaveLength(48)
    expect(
      screen.queryByRole("button", { name: /^Photo, photo-47\.jpg/ })
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: /^Photo, photo-48\.jpg/ })
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy()
  })

  it("keeps the prior snapshot on a later-page timeout and refreshes it on retry", async () => {
    vi.useFakeTimers()
    const all = feed(48)
    const current = all.filter((i) => i.id !== all[30].id)
    const loadPage = vi.fn<LoadPage>(async () => ({
      ok: true,
      page: feedPage(all, 24),
    }))
    const refreshPage = vi
      .fn<RefreshPage>()
      .mockImplementationOnce(async () => ({
        ok: true,
        page: feedPage(current, 0),
      }))
      .mockImplementationOnce(
        (signal) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            )
          )
      )
      .mockImplementation(async (_signal, cursor) => ({
        ok: true,
        page: feedPage(current, cursor ? Number(cursor.split(":")[1]) : 0),
      }))
    render(
      <MediaGallery
        label="Library"
        initialPage={feedPage(all, 0)}
        loadPage={loadPage}
        refreshPage={refreshPage}
        empty={<p>Empty</p>}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    })
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS)
    })
    expect(screen.getAllByRole("button", { name: /^Photo, / })).toHaveLength(48)
    expect(screen.getByRole("status").textContent).toContain(
      "Could not refresh"
    )
    expect(refreshPage).toHaveBeenCalledTimes(2)
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(screen.getAllByRole("button", { name: /^Photo, / })).toHaveLength(47)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("does not resurrect a locally deleted file from an in-flight refresh", async () => {
    let settle: (result: Awaited<ReturnType<RefreshPage>>) => void = () => {}
    let signal: AbortSignal | undefined
    const refreshPage = vi.fn<RefreshPage>((nextSignal) => {
      signal = nextSignal
      return new Promise((resolve) => {
        settle = resolve
      })
    })
    render(
      <MediaGallery
        label="Library"
        initialPage={{ items: [item(ID_A), item(ID_B)], nextCursor: null }}
        loadPage={vi.fn<LoadPage>()}
        refreshPage={refreshPage}
        canDelete
        empty={<p>Empty</p>}
      />
    )
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    fireEvent.click(screen.getByRole("button", { name: /^Photo, 01\.jpg/ }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Delete",
        })
      )
    })
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      settle({
        ok: true,
        page: { items: [item(ID_A), item(ID_B)], nextCursor: null },
      })
    })
    expect(screen.queryByRole("button", { name: /^Photo, 01\.jpg/ })).toBeNull()
    expect(screen.getByRole("button", { name: /^Photo, 02\.jpg/ })).toBeTruthy()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("ignores an older load-more result that arrives after a refresh reset", async () => {
    const all = feed(78)
    let settle: (result: Awaited<ReturnType<LoadPage>>) => void = () => {}
    const loadPage = vi
      .fn<LoadPage>()
      .mockImplementationOnce(
        () => new Promise((resolve) => (settle = resolve))
      )
      .mockImplementation(async (cursor) => ({
        ok: true,
        page: feedPage(all, Number(cursor?.split(":")[1])),
      }))
    const refreshPage = vi.fn<RefreshPage>(async (_signal, cursor) => ({
      ok: true,
      page: feedPage(all, cursor ? Number(cursor.split(":")[1]) : 0),
    }))
    render(
      <MediaGallery
        label="Library"
        initialPage={feedPage(all, 30)}
        loadPage={loadPage}
        refreshPage={refreshPage}
        empty={<p>Empty</p>}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    await act(async () => {
      settle({ ok: true, page: feedPage(all, 54) })
    })
    expect(screen.getAllByRole("button", { name: /^Photo, / })).toHaveLength(72)
    expect(
      screen.getByRole("button", { name: "Load more" }).hasAttribute("disabled")
    ).toBe(false)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    })
    expect(loadPage).toHaveBeenLastCalledWith("offset:72")
    expect(screen.getAllByRole("button", { name: /^Photo, / })).toHaveLength(78)
  })

  // Final review F5: the refresh is an abortable GET, so a hung one is really
  // cancelled and never holds up later Server Functions (uploads).
  it("aborts a hung refresh so the interval and focus refreshes keep working", async () => {
    vi.useFakeTimers()
    const newer = item("0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a03", {
      createdAt: "2026-10-29T12:05:00.000000+00:00",
    })
    const signals: AbortSignal[] = []
    // The first refresh never answers until aborted; later ones do.
    const refreshPage = vi
      .fn<RefreshPage>()
      .mockImplementationOnce(
        (signal) =>
          new Promise((_, reject) => {
            signals.push(signal)
            signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            )
          })
      )
      .mockImplementation(async (signal) => {
        signals.push(signal)
        return {
          ok: true,
          page: { items: [newer, item(ID_A), item(ID_B)], nextCursor: null },
        }
      })
    const loadPage = vi.fn<LoadPage>()
    renderGallery(loadPage, 15_000, undefined, refreshPage)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(refreshPage).toHaveBeenCalledTimes(1)
    // Still in flight: focus does not stack a second request on top of it.
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(refreshPage).toHaveBeenCalledTimes(1)

    // The hung request is aborted at the timeout, with a visible message...
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS)
    })
    expect(signals[0].aborted).toBe(true)
    expect(screen.getByRole("status").textContent).toContain(
      "Could not refresh"
    )
    // ...and the next focus refresh runs and shows the new upload.
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(refreshPage).toHaveBeenCalledTimes(2)
    expect(signals[1].aborted).toBe(false)
    expect(screen.queryByRole("status")).toBeNull()
    expect(
      screen
        .getAllByRole("button", { name: /^Photo, / })[0]
        .getAttribute("aria-label")
    ).toMatch(/^Photo, 03\.jpg/)

    // The interval keeps running too; the Server Function is never used for it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(refreshPage).toHaveBeenCalledTimes(3)
    expect(loadPage).not.toHaveBeenCalled()
  })

  it("never queues refreshes behind an unabortable one that hangs", async () => {
    vi.useFakeTimers()
    // Without refreshPage the gallery falls back to loadPage(null), which
    // cannot be cancelled: it reports the timeout but starts nothing new
    // until that call settles, so at most one is ever outstanding.
    let settle: (value: Awaited<ReturnType<LoadPage>>) => void = () => {}
    const loadPage = vi
      .fn<LoadPage>()
      .mockImplementationOnce(
        () => new Promise((resolve) => (settle = resolve))
      )
      .mockImplementation(async () => ({
        ok: true,
        page: { items: [item(ID_A), item(ID_B)], nextCursor: null },
      }))
    renderGallery(loadPage, 5_000)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000 + REFRESH_TIMEOUT_MS)
    })
    expect(screen.getByRole("status").textContent).toContain(
      "Could not refresh"
    )
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        window.dispatchEvent(new Event("focus"))
        await vi.advanceTimersByTimeAsync(5_000)
      })
    }
    expect(loadPage).toHaveBeenCalledTimes(1)

    await act(async () => {
      settle({ ok: false, message: "late" })
    })
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(loadPage).toHaveBeenCalledTimes(2)
  })
})

describe("failed downloads", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function openAndDownload(fetchImpl: typeof fetch) {
    const fetchMock = vi.fn(fetchImpl)
    vi.stubGlobal("fetch", fetchMock)
    renderGallery(
      vi.fn<LoadPage>(),
      undefined,
      (i) => `/api/media/${i.id}/download`
    )
    fireEvent.click(screen.getByRole("button", { name: /^Photo, 01\.jpg/ }))
    const dialog = await screen.findByRole("dialog")
    const link = screen.getByRole("link", { name: "Download original" })
    // jsdom does not navigate; the browser's own download is not prevented.
    link.addEventListener("click", (e) => {
      expect(e.defaultPrevented).toBe(false)
      e.preventDefault()
    })
    await act(async () => {
      fireEvent.click(link)
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/media/${ID_A}/download`,
      expect.objectContaining({ headers: { range: "bytes=0-0" } })
    )
    return dialog
  }

  it("shows an accessible error in the viewer when the original is missing", async () => {
    const dialog = await openAndDownload(
      async () => new Response("Not found.", { status: 404 })
    )
    const alert = await screen.findByRole("alert")
    expect(dialog.contains(alert)).toBe(true)
    expect(alert.textContent).toMatch(/could not be found/i)
  })

  it("explains a network failure", async () => {
    await openAndDownload(async () => {
      throw new TypeError("Failed to fetch")
    })
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /check your connection/i
    )
  })

  it("shows nothing when the download works", async () => {
    await openAndDownload(
      async () => new Response(new Uint8Array([1]), { status: 206 })
    )
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
