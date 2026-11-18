// @vitest-environment jsdom
// S3-R11 (review V18): the facility photos the admin Overview counts as
// waiting are listed on the admin Review page, and each opens the admin photo
// review (the manager route redirects admins). The manager's own Review keeps
// its links.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const VENUE = "00000000-0000-4000-8000-0000000000a1"
const ASSET = "00000000-0000-4000-8000-0000000000b1"

vi.mock("@/lib/server/review/inbox", () => ({
  listAmenityPhotoQueue: vi.fn(async () => ({
    ok: true,
    more: false,
    rows: [
      {
        checkId: "00000000-0000-4000-8000-0000000000c1",
        question: "Is there parking on site?",
        assetId: ASSET,
        uploaderName: "Sam",
        uploadedAt: "2026-11-09T10:00:00.000Z",
        hasThumbnail: false,
      },
    ],
  })),
}))

const { AmenityReviewSection } =
  await import("@/app/manager/review/_shared/amenity-section")
const { managerHrefs } = await import("@/components/nabalens/manager/hrefs")

const ctx = { venueId: VENUE } as never

afterEach(cleanup)

describe("AmenityReviewSection links (V18)", () => {
  it("opens the admin photo review on the admin Review page", async () => {
    render(await AmenityReviewSection({ ctx, venueId: VENUE }))
    const link = screen.getByRole("link", { name: /parking on site/ })
    expect(link.getAttribute("href")).toBe(
      `/admin/coverage/${VENUE}/menu-photos/photo/${ASSET}`
    )
    expect(managerHrefs.adminPhoto(VENUE, ASSET)).toBe(
      link.getAttribute("href")
    )
  })

  it("keeps the manager photo review in the workspace", async () => {
    render(await AmenityReviewSection({ ctx }))
    expect(
      screen.getByRole("link", { name: /parking on site/ }).getAttribute("href")
    ).toBe(managerHrefs.photo(ASSET))
  })
})
