// @vitest-environment jsdom
// S2-LIBRARY screens (spec §8 A4, §11, §16): asset detail with Select
// primary for every slot kind, withdraw and restore, removal with its impact
// preview, collections exported per venue, and the A4 filters. Database
// rules are in tests/security/library.test.ts.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }),
}))

const selectPrimaryAction = vi.fn()
const withdrawAssetAction = vi.fn()
const restoreAssetAction = vi.fn()
const setCollectionItemsAction = vi.fn()
vi.mock("@/app/admin/library/actions", () => ({
  selectPrimaryAction: (...a: unknown[]) => selectPrimaryAction(...a),
  withdrawAssetAction: (...a: unknown[]) => withdrawAssetAction(...a),
  restoreAssetAction: (...a: unknown[]) => restoreAssetAction(...a),
  correctVenueAction: vi.fn(async () => ({ ok: true, changed: true })),
  tagAssetsAction: vi.fn(async () => ({ ok: true, changed: true })),
  setCollectionItemsAction: (...a: unknown[]) => setCollectionItemsAction(...a),
  saveCollectionAction: vi.fn(async () => ({ ok: true, collectionId: "x" })),
  saveTagAction: vi.fn(async () => ({ ok: true, tagId: "x" })),
}))

const removeAcceptedMedia = vi.fn()
vi.mock("@/app/_media/removal-actions", () => ({
  removeAcceptedMedia: (...a: unknown[]) => removeAcceptedMedia(...a),
  declineRemovalRequest: vi.fn(async () => ({ ok: true })),
}))

import { LibraryMoreFilters } from "@/app/admin/library-more-filters"
import { AssetDetailView } from "@/app/admin/library/_components/asset-detail"
import { CollectionDetailView } from "@/app/admin/library/_components/collections"
import {
  impactLines,
  RemovalForm,
} from "@/app/admin/library/_components/removal"
import {
  NO_EXTRA_FILTERS,
  parseAssetDetail,
  type AssetDetail,
} from "@/lib/library/model"
import type { RemovalImpact } from "@/lib/media/removal"

const A = "00000000-0000-4000-8000-0000000000a1"
const V = "00000000-0000-4000-8000-0000000000b1"
const V2 = "00000000-0000-4000-8000-0000000000b2"
const U = "00000000-0000-4000-8000-0000000000c1"
const DISH = "00000000-0000-4000-8000-0000000000d1"
const PLACE = "00000000-0000-4000-8000-0000000000d2"
const PHOTO = "00000000-0000-4000-8000-0000000000e1"

function detail(over: Record<string, unknown> = {}): AssetDetail {
  return parseAssetDetail({
    asset: {
      id: A,
      venueId: V,
      venueName: "The Bell",
      uploaderId: U,
      uploaderName: "Sam",
      uploaderActive: true,
      mediaType: "image",
      originalFilename: "IMG_1.jpg",
      width: 1600,
      height: 1200,
      uploadState: "ready",
      createdAt: "2026-11-01T10:00:00+00:00",
      capturedAt: "2026-10-31T19:30:00+00:00",
      capturedAtSource: "metadata",
      contentSha256: "ab".repeat(32),
      deletedAt: null,
      timezone: "Europe/London",
    },
    review: "public",
    exportEligible: true,
    withdrawal: null,
    renditions: [],
    labels: { items: [], places: [] },
    labelHistory: [],
    decisions: [],
    slots: [
      {
        kind: "dish",
        slotId: DISH,
        name: "Chicken momo",
        state: "public",
        isPrimary: false,
        photoId: PHOTO,
        itemRevision: 3,
      },
      {
        kind: "area",
        slotId: PLACE,
        name: "Garden",
        state: "public",
        isPrimary: true,
      },
    ],
    evidence: [],
    exports: { packages: [] },
    tags: [],
    collections: [],
    duplicates: [],
    history: [],
    removalRequests: [],
    corrections: [],
    ...over,
  })!
}

const options = { venues: [], tags: [], collections: [] }

beforeEach(() => {
  refresh.mockReset()
  selectPrimaryAction.mockReset()
  withdrawAssetAction.mockReset()
  restoreAssetAction.mockReset()
  removeAcceptedMedia.mockReset()
  setCollectionItemsAction.mockReset()
})
afterEach(cleanup)

describe("asset detail", () => {
  it("shows provenance, review and where the photo is used", () => {
    render(<AssetDetailView detail={detail()} options={options} />)
    const state = screen.getByTestId("asset-state")
    expect(within(state).getByText("Approved for public use")).toBeTruthy()
    expect(within(state).getByText("Can be exported")).toBeTruthy()
    const slots = screen.getByTestId("asset-slots")
    expect(within(slots).getByText("Dish: Chicken momo")).toBeTruthy()
    expect(within(slots).getByText("Main photo")).toBeTruthy()
    expect(screen.getByText(/from the file/)).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: /Export this photo/ })
        .getAttribute("href")
    ).toBe(`/admin/publishing/new?venue=${V}&assets=${A}`)
  })

  it("selects the primary photo of a dish with its item revision", async () => {
    selectPrimaryAction.mockResolvedValue({ ok: true })
    render(<AssetDetailView detail={detail()} options={options} />)
    // The place is already primary: one button only, for the dish.
    const buttons = screen.getAllByRole("button", { name: /main photo for/ })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    await waitFor(() =>
      expect(selectPrimaryAction).toHaveBeenCalledWith({
        assetId: A,
        kind: "dish",
        slotId: DISH,
        photoId: PHOTO,
        itemRevision: 3,
      })
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("shows a refused primary beside the slot", async () => {
    selectPrimaryAction.mockResolvedValue({
      ok: false,
      error: "Restore this photo before making it the main photo.",
    })
    render(<AssetDetailView detail={detail()} options={options} />)
    fireEvent.click(screen.getByRole("button", { name: /main photo for/ }))
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Restore this photo/
    )
  })

  it("withdraws with a reason, and a withdrawn photo offers Restore only", async () => {
    withdrawAssetAction.mockResolvedValue({ ok: true, changed: true })
    const { unmount } = render(
      <AssetDetailView detail={detail()} options={options} />
    )
    fireEvent.click(screen.getByRole("button", { name: /Withdraw from use/ }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Shows a guest" },
    })
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Withdraw from use" })
    )
    await waitFor(() =>
      expect(withdrawAssetAction).toHaveBeenCalledWith({
        assetId: A,
        reason: "Shows a guest",
      })
    )
    unmount()

    render(
      <AssetDetailView
        detail={detail({
          exportEligible: false,
          withdrawal: {
            withdrawnAt: "2026-11-03T10:00:00+00:00",
            reason: "Shows a guest",
            byName: "Admin",
          },
        })}
        options={options}
      />
    )
    expect(screen.getByRole("button", { name: /Restore/ })).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: /Withdraw from use/ })
    ).toBeNull()
    expect(screen.queryByRole("button", { name: /main photo for/ })).toBeNull()
    expect(screen.queryByRole("link", { name: /Export this photo/ })).toBeNull()
    expect(screen.getByText(/Shows a guest/)).toBeTruthy()
  })

  it("links duplicates to the compare page", () => {
    render(
      <AssetDetailView
        detail={detail({
          duplicates: [
            {
              assetId: PHOTO,
              venueName: "The Crown",
              uploaderName: "Ali",
              createdAt: "2026-11-01T09:00:00+00:00",
              relation: "same_file",
            },
          ],
        })}
        options={options}
      />
    )
    expect(
      screen.getByRole("link", { name: "Compare" }).getAttribute("href")
    ).toBe(`/admin/library/compare?a=${A}&b=${PHOTO}`)
  })
})

const impact = (over: Partial<RemovalImpact> = {}): RemovalImpact => ({
  assetId: A,
  venueId: V,
  uploaderId: U,
  removed: false,
  accepted: true,
  menuItems: [
    { itemId: DISH, name: "Chicken momo", state: "accepted", isPrimary: true },
  ],
  areas: [],
  coverageSends: 0,
  amenityAnswers: 0,
  publicUses: 0,
  internalUses: 0,
  openRequests: 1,
  blocked: false,
  token: "tok",
  ...over,
})

describe("permanent removal", () => {
  it("lists the impact in plain words", () => {
    expect(impactLines(impact())).toEqual([
      "Dish Chicken momo: accepted, its main photo",
      "1 open removal request",
    ])
  })

  it("needs a reason and sends the preview's token", async () => {
    removeAcceptedMedia.mockResolvedValue({ ok: true, storage: "removed" })
    render(<RemovalForm assetId={A} impact={impact()} />)
    fireEvent.click(screen.getByRole("button", { name: /Remove permanently/ }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/reason/)
    expect(removeAcceptedMedia).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Guest asked" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Remove permanently/ }))
    await waitFor(() =>
      expect(removeAcceptedMedia).toHaveBeenCalledWith({
        assetId: A,
        reason: "Guest asked",
        impactToken: "tok",
      })
    )
    expect(await screen.findByText(/Permanently removed/)).toBeTruthy()
  })

  it("refuses while the photo is published", () => {
    render(
      <RemovalForm
        assetId={A}
        impact={impact({ publicUses: 1, blocked: true })}
      />
    )
    expect(screen.getByRole("alert").textContent).toMatch(/published/)
    expect(
      screen.queryByRole("button", { name: /Remove permanently/ })
    ).toBeNull()
  })
})

describe("collections", () => {
  const collection = {
    id: PLACE,
    name: "Winter",
    purpose: null,
    archivedAt: null,
    revision: 1,
    updatedAt: null,
    assetCount: 2,
    venues: [],
  }
  const photo = (id: string, venueId: string, venueName: string) => ({
    id,
    venueId,
    venueName,
    contributorName: "Sam",
    createdAt: "2026-11-01T10:00:00+00:00",
    thumbnailUrl: null,
  })

  it("exports each venue's photos separately and takes a photo out by reference", async () => {
    setCollectionItemsAction.mockResolvedValue({ ok: true, changed: true })
    render(
      <CollectionDetailView
        collection={collection}
        photos={[photo(A, V, "The Bell"), photo(PHOTO, V2, "The Crown")]}
        more={false}
      />
    )
    expect(
      screen
        .getByRole("link", { name: /Export 1 from The Bell/ })
        .getAttribute("href")
    ).toBe(`/admin/publishing/new?venue=${V}&assets=${A}`)
    expect(
      screen.getByRole("link", { name: /Export 1 from The Crown/ })
    ).toBeTruthy()
    fireEvent.click(screen.getAllByRole("button", { name: /Take out/ })[0]!)
    await waitFor(() =>
      expect(setCollectionItemsAction).toHaveBeenCalledWith({
        collectionId: PLACE,
        assetIds: [A],
        add: false,
      })
    )
    expect(screen.getByText(/never deletes it/)).toBeTruthy()
  })
})

describe("A4 filters", () => {
  it("opens when a filter is on and clears them all", () => {
    const onChange = vi.fn()
    const { container } = render(
      <LibraryMoreFilters
        value={{ ...NO_EXTRA_FILTERS, withdrawn: "withdrawn" }}
        options={{ tags: [], collections: [], requests: [], destinations: [] }}
        onChange={onChange}
      />
    )
    expect(container.querySelector("details")?.open).toBe(true)
    expect(screen.getByText("1 on")).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Taken from/), {
      target: { value: "2026-06-01" },
    })
    expect(onChange).toHaveBeenLastCalledWith({
      ...NO_EXTRA_FILTERS,
      withdrawn: "withdrawn",
      capturedFrom: "2026-06-01",
    })
    fireEvent.click(screen.getByRole("button", { name: "Clear these filters" }))
    expect(onChange).toHaveBeenLastCalledWith(NO_EXTRA_FILTERS)
  })
})
