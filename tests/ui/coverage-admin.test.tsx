// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AttachPhotosDialog,
  GroupCoverageTable,
  GroupParticipationTable,
  ManagerGrants,
  MANAGER_POWERS_COPY,
  PreparationRunList,
  VenueCoverageSummary,
  manageHrefs,
  type AttachPhotosHandler,
  type GrantHandlers,
  type GroupOverviewRow,
  type ManagerGrantView,
  type SubmittablePhoto,
} from "@/components/nabalens/coverage"

import { MANAGER_ID, STAFF_ID, VENUE, person } from "./coverage-fixtures"

afterEach(cleanup)
beforeEach(() => window.sessionStorage.clear())

function grant(overrides: Partial<ManagerGrantView> = {}): ManagerGrantView {
  return {
    id: "g-1",
    staff: { id: MANAGER_ID, displayName: "TEST Manager", active: true },
    staffVenueId: VENUE.id,
    venue: VENUE,
    grantedBy: { id: "admin-1", displayName: "TEST Admin" },
    grantedAt: "2026-11-01T09:00:00.000Z",
    grantReason: null,
    revokedAt: null,
    revokedByName: null,
    revokeKind: null,
    revokeReason: null,
    effective: true,
    ...overrides,
  }
}

function handlers(): GrantHandlers & {
  grant: ReturnType<typeof vi.fn>
  revoke: ReturnType<typeof vi.fn>
} {
  return {
    grant: vi.fn(async () => ({ ok: true as const })),
    revoke: vi.fn(async () => ({ ok: true as const })),
  }
}

describe("ManagerGrants", () => {
  it("states what manager status does not allow", () => {
    render(
      <ManagerGrants
        grants={[]}
        venues={[VENUE]}
        selectedVenueId={null}
        candidates={[]}
        includeRevoked={false}
        basePath="/admin/coverage/managers"
        onSelectVenue={vi.fn()}
        handlers={handlers()}
      />
    )
    expect(screen.getByText(MANAGER_POWERS_COPY)).toBeTruthy()
    expect(MANAGER_POWERS_COPY).toMatch(/invite or deactivate/)
    expect(MANAGER_POWERS_COPY).toMatch(/publish menus/)
    expect(MANAGER_POWERS_COPY).toMatch(/download originals/)
    expect(MANAGER_POWERS_COPY).toMatch(/delete colleagues’ photos/)
  })

  it("grants to a person at the chosen venue and leaves out current managers", async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(
      <ManagerGrants
        grants={[grant()]}
        venues={[VENUE]}
        selectedVenueId={VENUE.id}
        candidates={[
          person({ id: MANAGER_ID, displayName: "TEST Manager" }),
          person(),
        ]}
        includeRevoked={false}
        basePath="/admin/coverage/managers"
        onSelectVenue={vi.fn()}
        handlers={h}
      />
    )
    await user.click(screen.getByRole("button", { name: "Make venue manager" }))
    expect(screen.getByText("Choose a person.")).toBeTruthy()
    expect(h.grant).not.toHaveBeenCalled()

    await user.click(
      screen.getByLabelText("Person (active staff at that venue)")
    )
    const options = await screen.findAllByRole("option")
    expect(options.map((o) => o.textContent)).toEqual(["TEST Sam (Bartender)"])
    await user.click(options[0])
    await user.click(screen.getByRole("button", { name: "Make venue manager" }))
    expect(h.grant).toHaveBeenCalledWith({
      staffId: STAFF_ID,
      venueId: VENUE.id,
      reason: null,
    })
  })

  it("revokes only with a reason and shows ended grants with how they ended", async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(
      <ManagerGrants
        grants={[
          grant(),
          grant({
            id: "g-2",
            staff: { id: "x", displayName: "TEST Former", active: true },
            revokedAt: "2026-11-02T08:00:00.000Z",
            revokeKind: "venue_changed",
            effective: false,
          }),
        ]}
        venues={[VENUE]}
        selectedVenueId={null}
        candidates={[]}
        includeRevoked
        basePath="/admin/coverage/managers"
        onSelectVenue={vi.fn()}
        handlers={h}
      />
    )
    expect(screen.getByText("In effect")).toBeTruthy()
    expect(screen.getByText(/Ended: moved to another venue/)).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Hide ended grants" })
        .getAttribute("href")
    ).toBe("/admin/coverage/managers")

    await user.click(
      screen.getByRole("button", {
        name: "Revoke TEST Manager’s manager grant",
      })
    )
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }))
    expect(within(dialog).getByText("Give a reason.")).toBeTruthy()
    await user.type(within(dialog).getByLabelText("Reason"), "Stepped down")
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }))
    expect(h.revoke).toHaveBeenCalledWith({
      grantId: "g-1",
      reason: "Stepped down",
    })
  })

  it("flags an open grant that is no longer in effect after a move", () => {
    render(
      <ManagerGrants
        grants={[grant({ staffVenueId: "other", effective: false })]}
        venues={[VENUE]}
        selectedVenueId={null}
        candidates={[]}
        includeRevoked={false}
        basePath="/admin/coverage/managers"
        onSelectVenue={vi.fn()}
        handlers={handlers()}
      />
    )
    expect(
      screen.getByText("Not in effect: works at another venue now")
    ).toBeTruthy()
  })
})

function photo(overrides: Partial<SubmittablePhoto> = {}): SubmittablePhoto {
  return {
    assetId: "asset-1",
    thumbnailUrl: "/api/media/asset-1/thumb",
    previewUrl: "/api/media/asset-1/preview",
    width: 100,
    height: 100,
    uploadedAt: "2026-10-20T10:00:00.000Z",
    uploadedPeriod: "2026-10",
    uploader: { id: STAFF_ID, displayName: "TEST Sam", active: true },
    countsTowardMonthly: false,
    live: null,
    eligible: true,
    reason: null,
    ...overrides,
  }
}

describe("AttachPhotosDialog", () => {
  it("attaches eligible venue photos, explains ineligible ones and keeps authorship", async () => {
    const user = userEvent.setup()
    const onLoad = vi.fn(async () => ({
      ok: true as const,
      items: [
        photo(),
        photo({
          assetId: "asset-2",
          eligible: false,
          reason: "counted_elsewhere",
        }),
        photo({
          assetId: "asset-3",
          uploader: {
            id: MANAGER_ID,
            displayName: "TEST Manager",
            active: true,
          },
        }),
      ],
      nextCursor: null,
    }))
    const onAttach = vi.fn<AttachPhotosHandler>(async () => ({
      ok: true,
      submitted: [],
      skipped: [],
      replayed: false,
    }))
    render(
      <AttachPhotosDialog
        requirementTitle="Bar area"
        viewerId={MANAGER_ID}
        onLoad={onLoad}
        onAttach={onAttach}
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Attach existing photos" })
    )
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByText(/The photographer stays the author/)
    ).toBeTruthy()
    expect(
      await within(dialog).findByText(
        "Already counts for another checklist item."
      )
    ).toBeTruthy()
    const boxes = within(dialog).getAllByRole("checkbox", { name: /TEST/ })
    expect(boxes[1].hasAttribute("disabled")).toBe(true)

    await user.click(boxes[0])
    await user.click(boxes[2])
    await user.click(
      within(dialog).getByRole("checkbox", { name: /Accept them now/ })
    )
    expect(within(dialog).getByText(/recorded as a self-review/)).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", { name: "Attach 2 photos" })
    )
    expect(onAttach).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      assetIds: ["asset-1", "asset-3"],
      acceptNow: true,
    })
  })

  it("names each photo the server skipped with the reason", async () => {
    const user = userEvent.setup()
    render(
      <AttachPhotosDialog
        requirementTitle="Bar area"
        viewerId={MANAGER_ID}
        onLoad={async () => ({ ok: true, items: [photo()], nextCursor: null })}
        onAttach={async () => ({
          ok: true,
          submitted: [],
          skipped: [{ assetId: "asset-1", reason: "uploader_inactive" }],
          replayed: false,
        })}
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Attach existing photos" })
    )
    const dialog = await screen.findByRole("dialog")
    await user.click(
      await within(dialog).findByRole("checkbox", { name: /TEST Sam/ })
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Attach 1 photo" })
    )
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toContain(
      "TEST Sam, 20 Oct 2026: The photographer is no longer active."
    )
  })

  it("explains a refused attach, unticks the refused photos and reloads", async () => {
    const user = userEvent.setup()
    const onLoad = vi.fn(async () => ({
      ok: true as const,
      items: [photo(), photo({ assetId: "asset-2" })],
      nextCursor: null,
    }))
    const onAttach = vi.fn<AttachPhotosHandler>(async () => ({
      ok: false,
      code: "asset_ineligible",
      status: 409,
      message: "None of these photos can be added to this task.",
      assetErrors: [{ assetId: "asset-1", reason: "not_found" }],
    }))
    render(
      <AttachPhotosDialog
        requirementTitle="Bar area"
        viewerId={MANAGER_ID}
        onLoad={onLoad}
        onAttach={onAttach}
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Attach existing photos" })
    )
    const dialog = await screen.findByRole("dialog")
    const [first, second] = await within(dialog).findAllByRole("checkbox", {
      name: /TEST Sam/,
    })
    await user.click(first)
    await user.click(second)
    await user.click(
      within(dialog).getByRole("button", { name: "Attach 2 photos" })
    )
    expect(
      await within(dialog).findByText(
        "None of these photos can be added to this task."
      )
    ).toBeTruthy()
    const alerts = within(dialog).getAllByRole("alert")
    expect(alerts.map((a) => a.textContent).join(" ")).toContain(
      "TEST Sam, 20 Oct 2026: Not available: deleted, still processing or taken by someone who has left."
    )
    expect(onLoad).toHaveBeenCalledTimes(2)
    expect(
      within(dialog).getByRole("button", { name: "Attach 1 photo" })
    ).toBeTruthy()
  })
})

function overviewRow(
  overrides: Partial<GroupOverviewRow> = {}
): GroupOverviewRow {
  return {
    venue: VENUE,
    managers: [{ id: MANAGER_ID, displayName: "TEST Manager" }],
    coverage: {
      applicable: 10,
      satisfied: 4,
      needsSetup: 3,
      pendingReview: 2,
      overdue: 1,
      needsReassignment: 0,
      amenityUnknown: 2,
      menuState: "menu_changed",
      complete: false,
    },
    participation: {
      staff: 8,
      targetsSet: 6,
      targetsNeedingSetup: 2,
      staffWithoutTarget: 0,
      complete: 3,
      acceptedPhotos: 21,
    },
    selfReviews: 1,
    lastPreparation: { at: "2026-11-02T07:07:00.000Z", status: "succeeded" },
    ...overrides,
  }
}

describe("admin oversight tables", () => {
  it("report coverage and participation separately", () => {
    render(
      <>
        <GroupCoverageTable rows={[overviewRow()]} />
        <GroupParticipationTable
          rows={[overviewRow()]}
          periodLabel="November 2026"
        />
      </>
    )
    const coverage = screen.getByRole("region", { name: "Venue coverage" })
    expect(within(coverage).getByText("4 of 10")).toBeTruthy()
    expect(
      within(coverage).getByText("Menu changed — review coverage")
    ).toBeTruthy()
    expect(within(coverage).getByText("TEST Manager")).toBeTruthy()
    const participation = screen.getByRole("region", {
      name: "Staff participation, November 2026",
    })
    expect(within(participation).getByText("3 of 8")).toBeTruthy()
    expect(within(participation).getByText("21")).toBeTruthy()
    expect(
      within(coverage)
        .getByRole("link", { name: "TEST Venue" })
        .getAttribute("href")
    ).toBe(`/admin/coverage/${VENUE.id}`)
  })
})

describe("VenueCoverageSummary", () => {
  it("shows the menu-changed banner and never calls the venue complete then", () => {
    render(
      <VenueCoverageSummary
        summary={{
          venue: { ...VENUE, active: true },
          applicable: 5,
          satisfied: 5,
          needsSetup: 0,
          notApplicable: 1,
          pendingReview: 0,
          overdue: 0,
          needsReassignment: 0,
          amenityUnknown: 0,
          menuState: "reconciliation_pending",
          pendingReconciliation: 2,
          complete: false,
        }}
        hrefs={manageHrefs("/staff/manage")}
      />
    )
    expect(screen.getByText("Not complete yet")).toBeTruthy()
    expect(screen.getByRole("status").textContent).toMatch(
      /Menu changed — review coverage/
    )
    expect(screen.getByText("1 item not applicable (not counted)")).toBeTruthy()
    expect(screen.getByText("2 old sections to reconcile")).toBeTruthy()
  })
})

describe("PreparationRunList", () => {
  const failed = {
    id: "run-1",
    period: "2026-11" as const,
    venueId: null,
    trigger: "scheduled" as const,
    startedAt: "2026-11-03T10:00:00.000Z",
    finishedAt: "2026-11-03T10:00:01.000Z",
    status: "failed" as const,
    staffConsidered: 0,
    targetsCopied: 0,
    placeholdersCreated: 0,
    alreadyPresent: 0,
    candidatesAdded: 0,
    errorCode: "23505",
  }

  it("shows a failed run's stored code unless the caller formats it", () => {
    const page = { items: [failed], nextCursor: null }
    render(<PreparationRunList initial={page} venueNames={{}} />)
    expect(screen.getByText(/Error code 23505\./)).toBeTruthy()
    cleanup()
    render(
      <PreparationRunList
        initial={page}
        venueNames={{}}
        formatErrorCode={(code) =>
          code === "23505" ? "PREP_TARGET_CONFLICT" : code
        }
      />
    )
    expect(screen.getByText(/Error code PREP_TARGET_CONFLICT\./)).toBeTruthy()
  })
})
