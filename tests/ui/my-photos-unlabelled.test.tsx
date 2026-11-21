// @vitest-environment jsdom
// My photos when photos post straight to the Album (D21; the Open Design
// handoff of 20 Nov 2026): Unlabelled is the first block, with one count,
// the same list as the Unlabelled view, and Label photos.
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MyPhotos } from "@/components/nabalens/me/my-photos"
import type { MyUpload } from "@/lib/staff/my-uploads"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/app/staff/needs-attention", () => ({ NeedsAttention: () => null }))

afterEach(() => cleanup())

const VENUE = "00000000-0000-4000-8000-0000000000a1"

function photo(
  n: number,
  albumPost: MyUpload["albumPost"],
  venueId = VENUE
): MyUpload {
  return {
    assetId: `00000000-0000-4000-8000-00000000000${n}`,
    venueId,
    venueName: "The Old Crown",
    mediaType: "image",
    uploadState: "ready",
    uploadedAt: "2026-11-21T10:00:00Z",
    capturedAt: null,
    capturedAtSource: "unknown",
    duplicate: false,
    labelRevision: 0,
    sharedKinds: [],
    slots: [],
    labelHelp: false,
    removalRequested: false,
    removalRequestId: null,
    albumPost,
  }
}

const unlabelled = { removed: false, needs_attention: false, labelled: false }
const labelled = { removed: false, needs_attention: false, labelled: true }

function show(
  items: MyUpload[],
  next: { before: string; beforeId: string } | null = null
) {
  render(
    <MyPhotos
      initial={{ items, next }}
      show="all"
      currentVenueId={VENUE}
      posting
      canAdd
      loadMore={async () => ({ ok: true, page: { items: [], next: null } })}
    />
  )
}

describe("My photos: Unlabelled first (D21)", () => {
  it("leads with the unlabelled photos, their count and Label photos", () => {
    show([photo(1, unlabelled), photo(2, labelled), photo(3, unlabelled)])
    const block = screen.getByRole("region", { name: /Unlabelled/ })
    expect(within(block).getByText("2")).toBeTruthy()
    expect(
      within(block)
        .getByRole("link", { name: "Label photos" })
        .getAttribute("href")
    ).toBe("/staff/album/match-later?select=1")
    expect(
      within(block)
        .getByRole("link", { name: "See them all" })
        .getAttribute("href")
    ).toBe("/staff/photos?show=unlabelled")
    // First on the page, before the photo grid's day groups.
    const sections = screen.getAllByRole("region")
    expect(sections[0]).toBe(block)
  })

  it("marks a count that may grow with more pages", () => {
    show([photo(1, unlabelled)], {
      before: "2026-11-20T10:00:00Z",
      beforeId: "x",
    })
    expect(
      within(screen.getByRole("region", { name: /Unlabelled/ })).getByText("1+")
    ).toBeTruthy()
  })

  it("shows no block when every photo is labelled", () => {
    show([photo(1, labelled)])
    expect(screen.queryByRole("region", { name: /Unlabelled/ })).toBeNull()
  })

  it("offers no Label photos for another venue's photos", () => {
    show([photo(1, unlabelled, "00000000-0000-4000-8000-0000000000b9")])
    const block = screen.getByRole("region", { name: /Unlabelled/ })
    expect(
      within(block).queryByRole("link", { name: "Label photos" })
    ).toBeNull()
  })
})
