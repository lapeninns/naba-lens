// @vitest-environment jsdom
// S1-EXPORT screens (spec §14.1, §8 A5; AC31, AC32): choosing photos for a
// package, the package page (Download or Rebuild), and the follow-up list
// (Withdrawal pending, with Confirm only for admins). The database rules are
// in tests/security/exports.test.ts.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ExportCandidate,
  ExportPackageDetail,
  ExportProfile,
  PublicationOverview,
} from "@/lib/server/exports/model"
import { STALE_REASONS } from "@/lib/server/exports/model"
import { CHIP_STATES } from "@/components/nabalens/status-chip"

const push = vi.fn()
const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
}))

const createPackageAction = vi.fn()
const recordPublicationAction = vi.fn()
vi.mock("@/app/admin/publishing/actions", () => ({
  createPackageAction: (...a: unknown[]) => createPackageAction(...a),
  rebuildPackageAction: vi.fn(async () => ({
    ok: true,
    packageId: "x",
    removed: 1,
  })),
  recordPublicationAction: (...a: unknown[]) => recordPublicationAction(...a),
  saveDestinationAction: vi.fn(async () => ({ ok: true })),
  setProfileAction: vi.fn(async () => ({ ok: true })),
}))

import { ExportBuilder } from "@/app/admin/publishing/_components/export-builder"
import { PackageDetail } from "@/app/admin/publishing/_components/package-detail"
import { staleChip } from "@/app/admin/publishing/_components/copy"
import { PublicationPanels } from "@/app/admin/publishing/_components/panels"

const A1 = "00000000-0000-4000-8000-0000000000a1"
const A2 = "00000000-0000-4000-8000-0000000000a2"
const S1 = "00000000-0000-4000-8000-0000000000b1"
const S2 = "00000000-0000-4000-8000-0000000000b2"
const PKG = "00000000-0000-4000-8000-0000000000c1"
const DEST = "00000000-0000-4000-8000-0000000000d1"

const candidate = (over: Partial<ExportCandidate>): ExportCandidate => ({
  assetId: A1,
  subjectKind: "menu_item",
  subjectId: S1,
  subjectLabel: "Chicken momo",
  category: "food",
  approvalLevel: "public",
  approvalId: "p1",
  approvalVersion: "1",
  uploadedAt: "2026-11-17T10:00:00Z",
  width: 1200,
  height: 900,
  publication: { state: "not_selected", exportedAt: null, destinations: [] },
  ...over,
})

const profiles: ExportProfile[] = [
  {
    key: "original",
    label: "Original",
    format: "original",
    maxWidth: null,
    maxHeight: null,
    quality: null,
    revision: 1,
  },
  {
    key: "website",
    label: "Website image",
    format: "webp",
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 82,
    revision: 1,
  },
  {
    key: "custom",
    label: "Custom size",
    format: "jpeg",
    maxWidth: null,
    maxHeight: null,
    quality: 85,
    revision: 1,
  },
]

beforeEach(() => {
  push.mockReset()
  refresh.mockReset()
  createPackageAction.mockReset()
  recordPublicationAction.mockReset()
})
afterEach(cleanup)

describe("ExportBuilder", () => {
  const items = [
    candidate({}),
    candidate({
      assetId: A2,
      subjectKind: "place",
      subjectId: S2,
      subjectLabel: "The garden",
      category: "spaces",
      publication: {
        state: "exported",
        exportedAt: "2026-11-17T12:00:00Z",
        destinations: [],
      },
    }),
  ]

  it("asks for photos first, then makes the package with the chosen ones", async () => {
    createPackageAction.mockResolvedValue({ ok: true, packageId: PKG })
    render(
      <ExportBuilder
        area="manager"
        mode="public"
        candidates={items}
        profiles={profiles}
      />
    )
    const main = screen.getByRole("button", {
      name: /Choose photos to make a package/,
    })
    expect(main).toHaveProperty("disabled", true)
    // Exported shows as Exported, never as Published (AC31).
    expect(screen.getByText("Exported")).toBeTruthy()
    expect(screen.queryByText("Published")).toBeNull()

    fireEvent.click(screen.getAllByRole("checkbox", { name: "Include" })[0]!)
    fireEvent.change(screen.getByRole("textbox", { name: /Alt text/ }), {
      target: { value: "Momo on a slate" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Make package · 1 photo" })
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/manager/exports/packages/${PKG}`)
    )
    expect(createPackageAction).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "public",
        profileKey: "website",
        items: [
          {
            assetId: A1,
            subjectKind: "menu_item",
            subjectId: S1,
            altText: "Momo on a slate",
          },
        ],
      })
    )
  })

  it("keeps the choice and says why when the server refuses", async () => {
    createPackageAction.mockResolvedValue({
      ok: false,
      message: "A photo you chose can no longer be exported.",
    })
    render(
      <ExportBuilder
        area="admin"
        mode="public"
        candidates={items}
        profiles={profiles}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Choose all shown" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Make package · 2 photos" })
    )
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("can no longer be exported")
    )
    expect(
      screen.getByRole("button", { name: "Make package · 2 photos" })
    ).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
  })

  it("filters by the spec's categories and asks for a Custom size", () => {
    render(
      <ExportBuilder
        area="admin"
        mode="public"
        candidates={items}
        profiles={profiles}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /Spaces/ }))
    expect(screen.queryByText("Chicken momo")).toBeNull()
    expect(screen.getByText("The garden")).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: "Custom size" }))
    expect(
      screen.getByRole("textbox", { name: /Width in pixels/ })
    ).toBeTruthy()
  })

  it("says plainly when nothing is approved yet", () => {
    render(
      <ExportBuilder
        area="manager"
        mode="public"
        candidates={[]}
        profiles={profiles}
      />
    )
    expect(screen.getByRole("status").textContent).toMatch(
      /approved for public use yet/
    )
  })
})

const pkg = (over: Partial<ExportPackageDetail>): ExportPackageDetail => ({
  id: PKG,
  venueId: "v",
  venueName: "The Bell",
  mode: "public",
  profile: profiles[1]!,
  note: null,
  itemCount: 2,
  createdAt: "2026-11-18T09:00:00Z",
  createdBy: "TEST Sam",
  rebuiltFrom: null,
  state: "ready",
  staleAssets: [],
  invalidatedAt: null,
  invalidatedReason: null,
  lastExportedAt: null,
  items: [
    {
      ...candidate({}),
      position: 1,
      venueId: "v",
      filenameStem: "the-bell-chicken-momo-00000000",
      altText: null,
      caption: null,
      useRestrictions: [],
      eligible: true,
      staleReason: null,
    },
    {
      ...candidate({ assetId: A2, subjectId: S2, subjectLabel: "Dal" }),
      position: 2,
      venueId: "v",
      filenameStem: "the-bell-dal-00000000",
      altText: null,
      caption: null,
      useRestrictions: [],
      eligible: true,
      staleReason: null,
    },
  ],
  downloads: [],
  ...over,
})

describe("PackageDetail", () => {
  it("offers Download ZIP for a ready package", () => {
    render(
      <PackageDetail
        area="manager"
        pkg={pkg({})}
        notice={null}
        destinations={null}
        today="2026-11-18"
      />
    )
    const link = screen.getByRole("link", { name: "Download ZIP" })
    expect(link.getAttribute("href")).toBe(
      `/api/exports/${PKG}/download?from=manager`
    )
    expect(screen.queryByText(/Record where it/)).toBeNull()
  })

  it("explains an invalidated package and offers Rebuild, not Download (AC32)", () => {
    render(
      <PackageDetail
        area="admin"
        pkg={pkg({
          state: "invalidated",
          staleAssets: [A2],
          items: pkg({}).items.map((i) => ({
            ...i,
            eligible: i.assetId !== A2,
            staleReason: i.assetId === A2 ? "withdrawn" : null,
          })),
        })}
        notice="invalidated"
        destinations={[]}
        today="2026-11-18"
      />
    )
    expect(screen.getByRole("alert").textContent).toMatch(/can't be downloaded/)
    expect(screen.queryByRole("link", { name: "Download ZIP" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Rebuild without those photos" })
    ).toBeTruthy()
    expect(screen.getByText("Withdrawn since")).toBeTruthy()
  })

  it("says why a photo is stale, never Withdrawn for a review change (X10)", () => {
    render(
      <PackageDetail
        area="admin"
        pkg={pkg({
          state: "needs_rebuild",
          staleAssets: [A2],
          items: pkg({}).items.map((i) => ({
            ...i,
            eligible: i.assetId !== A2,
            staleReason: i.assetId === A2 ? "review_changed" : null,
          })),
        })}
        notice={null}
        destinations={[]}
        today="2026-11-18"
      />
    )
    expect(screen.getByText("Review changed since")).toBeTruthy()
    expect(screen.queryByText(/Withdrawn since/)).toBeNull()
    for (const reason of STALE_REASONS)
      expect(Object.hasOwn(CHIP_STATES, staleChip(reason))).toBe(true)
    // An unknown reason still draws a chip that is not a withdrawal.
    expect(staleChip(null)).toBe("package_item_changed")
  })
})

const overview = (canRecord: boolean): PublicationOverview => ({
  canRecord,
  destinations: [
    {
      id: DEST,
      venueId: "v",
      venueName: "The Bell",
      label: "The Bell website",
      url: "https://example.test",
      active: true,
      revision: 1,
      published: 0,
      pending: 1,
      failed: 0,
      lastPublishedOn: "2026-11-01",
    },
  ],
  outstanding: [
    {
      destinationId: DEST,
      destinationLabel: "The Bell website",
      assetId: A1,
      venueId: "v",
      venueName: "The Bell",
      subjectLabel: "The garden",
      state: "withdrawal_pending",
      requested: false,
      externalUrl: "https://example.test/garden",
      externalRef: null,
      since: "2026-11-18T08:00:00Z",
    },
  ],
  published: [],
  recent: [],
})

describe("PublicationPanels", () => {
  it("shows Withdrawal pending until an admin confirms the removal (AC33)", async () => {
    recordPublicationAction.mockResolvedValue({
      ok: true,
      state: "withdrawn_confirmed",
    })
    render(
      <PublicationPanels
        part="outstanding"
        overview={overview(true)}
        today="2026-11-18"
      />
    )
    expect(screen.getByText("Withdrawal pending")).toBeTruthy()
    expect(screen.getByText(/can't be recalled/)).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm it's taken down" })
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(recordPublicationAction).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationId: DEST,
        assetId: A1,
        action: "withdrawn",
        occurredOn: "2026-11-18",
      })
    )
  })

  it("is read only for a manager", () => {
    render(
      <PublicationPanels
        part="outstanding"
        overview={overview(false)}
        today="2026-11-18"
      />
    )
    expect(screen.getByText("Withdrawal pending")).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Confirm it's taken down" })
    ).toBeNull()
  })
})
