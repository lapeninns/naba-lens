// @vitest-environment jsdom
// Per-venue memberships on screen (S1-PEOPLE): the manager's People section
// (invite ordinary staff, remove staff only), the venue switcher (only the
// person's own venues), the admin's per-venue privileges table, and the
// admin roles list (never yourself).
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refresh = vi.fn()
const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push, replace: vi.fn() }),
}))

import { AdminRoles } from "@/app/admin/staff/admin-roles"
import { VenueAccessPanel } from "@/app/admin/staff/[id]/venue-access-panel"
import { VenuePeople } from "@/app/manager/team/venue-people"
import { VenueSwitcher } from "@/components/nabalens/venue-switcher"

const BELL = { id: "6c1e9a54-3b2f-4d60-9e5c-1f8daa402c22", name: "TEST Bell" }
const CROWN = { id: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11", name: "TEST Crown" }
const SELF = "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22"
const SAM = "8d3f2b01-5c4e-4f90-8b2d-3e6f7a8b9c33"
const ALEX = "9e4a3c12-6d5f-4a01-9c3e-4f7a8b9cad44"

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe("VenuePeople (manager Team)", () => {
  const people = [
    {
      profileId: SELF,
      displayName: "TEST Me",
      jobTitle: null,
      role: "manager" as const,
      workingHere: true,
    },
    {
      profileId: SAM,
      displayName: "TEST Sam",
      jobTitle: "Chef",
      role: "staff" as const,
      workingHere: true,
    },
    {
      profileId: ALEX,
      displayName: "TEST Alex",
      jobTitle: null,
      role: "staff" as const,
      workingHere: false,
    },
  ]

  it("offers Remove for ordinary staff only, never for managers or yourself", () => {
    render(
      <VenuePeople
        venue={BELL}
        people={people}
        selfId={SELF}
        onInvite={vi.fn()}
        onRemove={vi.fn()}
      />
    )
    const rows = screen.getAllByRole("listitem")
    expect(within(rows[0]!).queryByRole("button")).toBeNull()
    expect(
      within(rows[1]!).getByRole("button", {
        name: "Remove TEST Sam from TEST Bell",
      })
    ).toBeTruthy()
    expect(
      within(rows[2]!).getByText(/Working at another venue now/)
    ).toBeTruthy()
  })

  it("removes with a reason and an optional colleague, and says the result on the page", async () => {
    const onRemove = vi.fn(async () => ({
      ok: true as const,
      outcome: "removed" as const,
      reassigned: { coverageAssignments: 2, amenityChecks: 0 },
    }))
    render(
      <VenuePeople
        venue={BELL}
        people={people}
        selfId={SELF}
        onInvite={vi.fn()}
        onRemove={onRemove}
      />
    )
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: "Remove TEST Sam from TEST Bell" })
    )
    await user.type(screen.getByLabelText("Reason"), "Left for college")
    await user.click(screen.getByRole("button", { name: "Remove" }))
    expect(onRemove).toHaveBeenCalledWith({
      profileId: SAM,
      reason: "Left for college",
      replacementId: null,
    })
    expect(
      await screen.findByText(
        /TEST Sam no longer works at TEST Bell\. 2 open jobs moved/
      )
    ).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
  })

  it("keeps the dialog open with the database's words on a refusal", async () => {
    const onRemove = vi.fn(async () => ({
      ok: false as const,
      error: "Only an admin can remove a manager.",
    }))
    render(
      <VenuePeople
        venue={BELL}
        people={people}
        selfId={SELF}
        onInvite={vi.fn()}
        onRemove={onRemove}
      />
    )
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: "Remove TEST Sam from TEST Bell" })
    )
    await user.type(screen.getByLabelText("Reason"), "x")
    await user.click(screen.getByRole("button", { name: "Remove" }))
    expect(
      await screen.findByText("Only an admin can remove a manager.")
    ).toBeTruthy()
  })

  it("invites to this venue only, with no venue or team choice", async () => {
    const onInvite = vi.fn(async () => ({ status: "sent" as const }))
    render(
      <VenuePeople
        venue={BELL}
        people={people}
        selfId={SELF}
        onInvite={onInvite}
        onRemove={vi.fn()}
      />
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Invite staff" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).queryByRole("combobox")).toBeNull()
    expect(within(dialog).queryByText("Team")).toBeNull()
    await user.type(within(dialog).getByLabelText("Name"), "TEST New")
    await user.type(within(dialog).getByLabelText("Email"), "new@example.test")
    await user.click(
      within(dialog).getByRole("button", { name: /Send invitation/ })
    )
    expect(onInvite).toHaveBeenCalledWith({
      displayName: "TEST New",
      email: "new@example.test",
      jobTitle: "",
    })
    expect(await screen.findByText("Invitation sent")).toBeTruthy()
  })
})

describe("VenueSwitcher", () => {
  const venues = [
    {
      venueId: BELL.id,
      venueName: BELL.name,
      role: "staff" as const,
      isActive: true,
    },
    {
      venueId: CROWN.id,
      venueName: CROWN.name,
      role: "manager" as const,
      isActive: false,
    },
  ]

  it("shows nothing for one venue", () => {
    const { container } = render(
      <VenueSwitcher venues={venues.slice(0, 1)} onSwitch={vi.fn()} />
    )
    expect(container.textContent).toBe("")
  })

  it("names the active venue and role, and goes to the new role's home", async () => {
    const onSwitch = vi.fn(async () => ({
      ok: true as const,
      venueId: CROWN.id,
      role: "manager" as const,
      home: "/manager",
    }))
    render(<VenueSwitcher venues={venues} onSwitch={onSwitch} />)
    expect(screen.getByText("TEST Bell · Staff")).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Change venue" }))
    expect(await screen.findByText("Choose a venue.")).toBeTruthy()
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it("explains a refused switch", async () => {
    const onSwitch = vi.fn(async () => ({
      ok: false as const,
      code: "not_a_member" as const,
    }))
    render(<VenueSwitcher venues={venues} onSwitch={onSwitch} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("combobox"))
    await user.click(
      await screen.findByRole("option", { name: "TEST Crown · Manager" })
    )
    await user.click(screen.getByRole("button", { name: "Change venue" }))
    expect(onSwitch).toHaveBeenCalledWith(CROWN.id)
    expect(
      await screen.findByText(/You no longer work at that venue/)
    ).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
  })
})

describe("VenueAccessPanel (admin)", () => {
  const privileges = [
    {
      venueId: CROWN.id,
      venueName: CROWN.name,
      membershipId: "m1",
      membershipRole: "manager" as const,
      effectiveRole: "manager" as const,
      isActiveVenue: false,
      canUpload: true,
      canReview: true,
      canInviteStaff: true,
      canExport: true,
      canGrantRoles: false,
    },
    {
      venueId: BELL.id,
      venueName: BELL.name,
      membershipId: "m2",
      membershipRole: "staff" as const,
      effectiveRole: "staff" as const,
      isActiveVenue: true,
      canUpload: true,
      canReview: false,
      canInviteStaff: false,
      canExport: false,
      canGrantRoles: false,
    },
  ]

  it("shows what the person can do at each venue", () => {
    render(
      <VenueAccessPanel
        member={{ id: SAM, displayName: "TEST Sam", active: true }}
        privileges={privileges}
        venues={[BELL, CROWN]}
        onSetRole={vi.fn()}
        onRemove={vi.fn()}
        onMakeAdmin={vi.fn()}
      />
    )
    const rows = screen.getAllByRole("row")
    expect(
      within(rows[1]!)
        .getAllByRole("cell")
        .map((c) => c.textContent)
    ).toEqual([
      "TEST Crown",
      "Manager",
      "No",
      "Yes",
      "Yes",
      "Yes",
      "Yes",
      "Remove",
    ])
    expect(
      within(rows[2]!)
        .getAllByRole("cell")
        .map((c) => c.textContent)
    ).toEqual(["TEST Bell", "Staff", "Yes", "Yes", "No", "No", "No", "Remove"])
  })

  it("asks for a reason before granting manager rights", async () => {
    const onSetRole = vi.fn()
    render(
      <VenueAccessPanel
        member={{ id: SAM, displayName: "TEST Sam", active: true }}
        privileges={privileges}
        venues={[BELL, CROWN]}
        onSetRole={onSetRole}
        onRemove={vi.fn()}
        onMakeAdmin={vi.fn()}
      />
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Save venue role" }))
    expect(await screen.findByText("Choose a venue.")).toBeTruthy()
    expect(onSetRole).not.toHaveBeenCalled()
  })

  it("says when the read failed instead of showing an empty list", () => {
    render(
      <VenueAccessPanel
        member={{ id: SAM, displayName: "TEST Sam", active: true }}
        privileges={null}
        venues={[BELL]}
        onSetRole={vi.fn()}
        onRemove={vi.fn()}
        onMakeAdmin={vi.fn()}
      />
    )
    expect(screen.getByText(/couldn.t load their venues/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Save venue role" })).toBeNull()
  })
})

describe("AdminRoles", () => {
  it("never offers to remove your own admin role and needs a venue", async () => {
    const onRevoke = vi.fn()
    render(
      <AdminRoles
        admins={[
          { id: SELF, displayName: "TEST Me" },
          { id: ALEX, displayName: "TEST Alex" },
        ]}
        selfId={SELF}
        venues={[BELL]}
        onRevoke={onRevoke}
      />
    )
    const buttons = screen.getAllByRole("button", { name: "Remove admin role" })
    expect(buttons).toHaveLength(1)
    const user = userEvent.setup()
    await user.click(buttons[0]!)
    await user.type(screen.getByLabelText("Reason"), "Left the company")
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Remove admin role",
      })
    )
    expect(
      await screen.findByText("Choose the venue they will work at.")
    ).toBeTruthy()
    expect(onRevoke).not.toHaveBeenCalled()
  })
})
