// @vitest-environment jsdom
// Admin account type: a staff account is made a venue manager (venue + reason),
// a manager account returns to staff (venue + reason), and Venue managers lists
// manager accounts as grant candidates and labels legacy staff-held grants.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ManagerGrantView } from "@/components/nabalens/coverage/types"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}))

const convertToManagerAction = vi.fn()
const convertToStaffAction = vi.fn()
vi.mock("@/app/admin/staff/actions", () => ({
  convertToManagerAction: (...args: unknown[]) =>
    convertToManagerAction(...args),
  convertToStaffAction: (...args: unknown[]) => convertToStaffAction(...args),
}))

const grantVenueManagerAction = vi.fn()
vi.mock("@/app/_coverage/actions", () => ({
  grantVenueManagerAction: (...args: unknown[]) =>
    grantVenueManagerAction(...args),
  revokeVenueManagerAction: vi.fn(async () => ({ ok: true })),
}))

import { AccountTypePanel } from "@/app/admin/staff/[id]/account-type-panel"
import { ManagersView } from "@/app/admin/coverage/managers/managers-view"

const VENUE = {
  id: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11",
  name: "TEST Railway",
}
const BELL = { id: "6c1e9a54-3b2f-4d60-9e5c-1f8daa402c22", name: "TEST Bell" }
const SAM = "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22"

const member = (status: "active" | "invited" | "inactive" = "active") => ({
  id: SAM,
  displayName: "TEST Sam",
  status,
  venueId: VENUE.id,
  venueName: VENUE.name,
})

const grant = (
  overrides: Partial<{
    effective: boolean
    revokedAt: string | null
    revokeKind:
      "revoked" | "venue_changed" | "deactivated" | "role_changed" | null
    venueId: string
  }> = {}
) => ({
  venueId: VENUE.id,
  venueName: VENUE.name,
  grantedAt: "2026-11-01T09:00:00.000Z",
  grantedByName: "TEST Admin",
  revokedAt: null,
  revokeKind: null,
  effective: true,
  ...overrides,
})

beforeEach(() => {
  window.sessionStorage.clear()
  refresh.mockClear()
  convertToManagerAction.mockReset()
  convertToStaffAction.mockReset()
  grantVenueManagerAction.mockReset()
})
afterEach(cleanup)

describe("Account type panel", () => {
  it("makes a staff account a venue manager with the venue and a reason", async () => {
    const user = userEvent.setup()
    convertToManagerAction.mockResolvedValue({
      ok: true,
      profileId: SAM,
      role: "manager",
      venueId: VENUE.id,
      grantId: "g",
      replayed: false,
    })
    render(
      <AccountTypePanel
        member={member()}
        role="staff"
        venues={[VENUE, BELL]}
        grant={null}
        history={[]}
      />
    )
    expect(screen.getByText("Staff account")).toBeTruthy()
    expect(screen.getByText("No account type changes yet.")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Make venue manager" }))
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByText("Make TEST Sam a venue manager?")
    ).toBeTruthy()
    expect(
      within(dialog).getByText(
        "They'll sign in to the manager workspace for TEST Railway."
      )
    ).toBeTruthy()
    expect(within(dialog).getByText("Their open photo tasks end.")).toBeTruthy()

    // The reason is required.
    await user.click(
      within(dialog).getByRole("button", { name: "Make venue manager" })
    )
    expect(within(dialog).getByText("Give a reason.")).toBeTruthy()
    expect(convertToManagerAction).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText("Reason"), "Runs the bar")
    await user.click(
      within(dialog).getByRole("button", { name: "Make venue manager" })
    )
    expect(convertToManagerAction).toHaveBeenCalledTimes(1)
    const input = convertToManagerAction.mock.calls[0][0]
    expect(input).toMatchObject({
      profileId: SAM,
      venueId: VENUE.id,
      reason: "Runs the bar",
    })
    expect(input.requestId).toMatch(/^[A-Za-z0-9_-]{8,128}$/)
    expect(
      await screen.findByText(/TEST Sam is now a venue manager at TEST Railway/)
    ).toBeTruthy()
  })

  it("reuses the request id when the same conversion is retried", async () => {
    const user = userEvent.setup()
    convertToManagerAction
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        ok: true,
        profileId: SAM,
        role: "manager",
        venueId: VENUE.id,
        grantId: "g",
        replayed: true,
      })
    render(
      <AccountTypePanel
        member={member()}
        role="staff"
        venues={[VENUE]}
        grant={null}
        history={[]}
      />
    )
    await user.click(screen.getByRole("button", { name: "Make venue manager" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Reason"), "Runs the bar")
    const confirm = within(dialog).getByRole("button", {
      name: "Make venue manager",
    })
    await user.click(confirm)
    await user.click(confirm)
    expect(convertToManagerAction).toHaveBeenCalledTimes(2)
    expect(convertToManagerAction.mock.calls[1][0].requestId).toBe(
      convertToManagerAction.mock.calls[0][0].requestId
    )
  })

  it("keeps the dialog open with the server's message on a refusal", async () => {
    const user = userEvent.setup()
    convertToManagerAction.mockResolvedValue({
      ok: false,
      code: "invalid_input",
      status: 400,
      message: "Choose an active venue.",
      fieldErrors: { venueId: "This venue is inactive or no longer exists." },
    })
    render(
      <AccountTypePanel
        member={member()}
        role="staff"
        venues={[VENUE]}
        grant={null}
        history={[]}
      />
    )
    await user.click(screen.getByRole("button", { name: "Make venue manager" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Reason"), "Runs the bar")
    await user.click(
      within(dialog).getByRole("button", { name: "Make venue manager" })
    )
    expect(
      await within(dialog).findByText(
        "This venue is inactive or no longer exists."
      )
    ).toBeTruthy()
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("explains why an inactive account can't change type", () => {
    render(
      <AccountTypePanel
        member={member("inactive")}
        role="staff"
        venues={[VENUE]}
        grant={null}
        history={[]}
      />
    )
    const button = screen.getByRole("button", {
      name: "Make venue manager",
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(
      screen.getByText("Reactivate the account before changing its type.")
    ).toBeTruthy()
  })

  it("notes a legacy staff-held grant on a staff account", () => {
    render(
      <AccountTypePanel
        member={member()}
        role="staff"
        venues={[VENUE]}
        grant={grant()}
        history={[]}
      />
    )
    expect(screen.getByText(/Legacy staff grant at TEST Railway/)).toBeTruthy()
  })

  it("shows a manager account's access and returns it to staff", async () => {
    const user = userEvent.setup()
    convertToStaffAction.mockResolvedValue({
      ok: true,
      profileId: SAM,
      role: "staff",
      venueId: VENUE.id,
      grantId: null,
      replayed: false,
    })
    render(
      <AccountTypePanel
        member={member()}
        role="manager"
        venues={[VENUE, BELL]}
        grant={grant()}
        history={[
          {
            id: 2,
            at: "2026-11-05T10:00:00.000Z",
            actorName: "TEST Admin",
            from: "staff",
            to: "manager",
            venueId: VENUE.id,
            reason: "Runs the bar",
          },
        ]}
      />
    )
    expect(screen.getByText("Venue manager · TEST Railway")).toBeTruthy()
    expect(screen.getByText(/Venue access in effect since/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Give access at/ })).toBeNull()
    const history = screen.getByRole("list", { name: "History" })
    expect(history.textContent).toMatch(
      /TEST Admin · Staff → Venue manager · Runs the bar/
    )

    await user.click(
      screen.getByRole("button", { name: "Return to staff account" })
    )
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByText("Return TEST Sam to a staff account?")
    ).toBeTruthy()
    expect(
      within(dialog).getByText("Their venue access ends now.")
    ).toBeTruthy()
    await user.type(within(dialog).getByLabelText("Reason"), "Stepped down")
    await user.click(
      within(dialog).getByRole("button", { name: "Return to staff account" })
    )
    expect(convertToStaffAction).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: SAM,
        venueId: VENUE.id,
        reason: "Stepped down",
      })
    )
    expect(convertToManagerAction).not.toHaveBeenCalled()
  })

  it("offers to give access again when a manager's access ended", async () => {
    const user = userEvent.setup()
    grantVenueManagerAction.mockResolvedValue({ ok: true, grantId: "g2" })
    render(
      <AccountTypePanel
        member={member()}
        role="manager"
        venues={[VENUE]}
        grant={grant({
          effective: false,
          revokedAt: "2026-11-06T10:00:00.000Z",
          revokeKind: "revoked",
        })}
        history={null}
      />
    )
    expect(
      screen.getByText("Venue access ended (revoked by an admin).")
    ).toBeTruthy()
    expect(
      screen.getByText("The account type history couldn't be loaded.")
    ).toBeTruthy()
    await user.click(
      screen.getByRole("button", { name: "Give access at TEST Railway" })
    )
    expect(grantVenueManagerAction).toHaveBeenCalledWith({
      staffId: SAM,
      venueId: VENUE.id,
      reason: null,
    })
    expect(
      await screen.findByText(/TEST Sam now has venue access at TEST Railway/)
    ).toBeTruthy()
  })
})

function managerGrant(
  overrides: Partial<ManagerGrantView> = {}
): ManagerGrantView {
  return {
    id: "g-1",
    staff: { id: SAM, displayName: "TEST Sam", active: true },
    staffVenueId: VENUE.id,
    venue: VENUE,
    grantedBy: { id: "a", displayName: "TEST Admin" },
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

describe("Venue managers", () => {
  it("labels legacy staff-held grants and explains them", () => {
    render(
      <ManagersView
        grants={[
          managerGrant({ legacyStaffGrant: true }),
          managerGrant({
            id: "g-2",
            staff: { id: "m", displayName: "TEST Mia", active: true },
          }),
        ]}
        venues={[VENUE]}
        selectedVenueId={null}
        candidates={[]}
        includeRevoked={false}
        basePath="/admin/coverage/managers"
      />
    )
    const table = screen.getByRole("table", { name: "Current grants" })
    const sam = within(table).getByText("TEST Sam").closest("tr")!
    expect(within(sam).getByText("Legacy staff grant")).toBeTruthy()
    const mia = within(table).getByText("TEST Mia").closest("tr")!
    expect(within(mia).queryByText("Legacy staff grant")).toBeNull()
    expect(
      screen.getByText(/stays in effect until you convert the person/)
    ).toBeTruthy()
  })

  it("lists manager accounts without access and gives one access", async () => {
    const user = userEvent.setup()
    grantVenueManagerAction.mockResolvedValue({ ok: true, grantId: "g" })
    render(
      <ManagersView
        grants={[]}
        venues={[VENUE]}
        selectedVenueId={VENUE.id}
        candidates={[
          {
            id: SAM,
            displayName: "TEST Sam",
            avatarUrl: null,
            department: null,
            jobTitle: null,
            active: true,
          },
        ]}
        includeRevoked={false}
        basePath="/admin/coverage/managers"
      />
    )
    expect(
      screen.getByText("Manager accounts at this venue without access.")
    ).toBeTruthy()
    await user.click(screen.getByLabelText("Venue manager"))
    const options = await screen.findAllByRole("option")
    expect(options.map((o) => o.textContent)).toEqual(["TEST Sam"])
    await user.click(options[0])
    await user.click(screen.getByRole("button", { name: "Give access" }))
    expect(grantVenueManagerAction).toHaveBeenCalledWith({
      staffId: SAM,
      venueId: VENUE.id,
      reason: null,
    })
  })

  it("says why a grant is not in effect", () => {
    render(
      <ManagersView
        grants={[managerGrant({ effective: false, staffVenueId: BELL.id })]}
        venues={[VENUE, BELL]}
        selectedVenueId={null}
        candidates={[]}
        includeRevoked={false}
        basePath="/admin/coverage/managers"
      />
    )
    expect(
      screen.getByText("Not in effect: works at another venue now")
    ).toBeTruthy()
  })
})
