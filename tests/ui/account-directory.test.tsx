// @vitest-environment jsdom
// The redesigned Staff screens: people order, filters, one More actions menu
// per row, and what a venue move or a deactivation says it ends.
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { StaffMember } from "@/components/nabalens"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

const setStaffActiveAction = vi.fn()
const updateStaffAccountAction = vi.fn()
vi.mock("@/app/admin/staff/actions", () => ({
  setStaffActiveAction: (...args: unknown[]) => setStaffActiveAction(...args),
  updateStaffAccountAction: (...args: unknown[]) =>
    updateStaffAccountAction(...args),
  resendInvitationAction: vi.fn(async () => ({ ok: true })),
  inviteStaffAction: vi.fn(async () => ({ status: "sent" })),
}))

import { StaffDirectory } from "@/app/admin/staff/staff-directory"
import { sortStaff } from "@/app/admin/staff/staff-order"

const RAILWAY = {
  id: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11",
  name: "TEST Railway",
}
const BELL = { id: "6c1e9a54-3b2f-4d60-9e5c-1f8daa402c22", name: "TEST Bell" }

let n = 0
function person(
  displayName: string,
  extra: Partial<StaffMember> = {}
): StaffMember {
  n += 1
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    displayName,
    avatarUrl: null,
    jobTitle: null,
    department: "foh",
    venueId: RAILWAY.id,
    venueName: RAILWAY.name,
    email: `${displayName.toLowerCase().replace(/\s+/g, ".")}@nabalens.test`,
    status: "active",
    ...extra,
  }
}

const staff = [
  person("Priya Gurung", { department: "boh" }),
  person("Tom Hughes", { status: "inactive", department: null }),
  person("Ben Clarke"),
  person("Sita Gurung"),
  person("Josh Patel", { status: "invited" }),
  person("Anil Thapa", { department: null }),
  person("Dan Cooper"),
]

const names = () =>
  within(screen.getByRole("table", { name: "Staff" }))
    .getAllByRole("link")
    .map((link) => link.textContent)

function directory(
  props: { grants?: Parameters<typeof StaffDirectory>[0]["grants"] } = {}
) {
  return (
    <StaffDirectory
      staff={staff}
      venues={[RAILWAY, BELL]}
      grants={props.grants ?? []}
      maxAvatarBytes={5 << 20}
    />
  )
}

beforeEach(() => {
  setStaffActiveAction.mockReset()
  updateStaffAccountAction.mockReset()
})
afterEach(cleanup)

describe("people order", () => {
  it("puts Needs setup and Invited first, then A to Z by surname, ties by first name", () => {
    expect(sortStaff(staff).map((m) => m.displayName)).toEqual([
      "Josh Patel", // invited
      "Anil Thapa", // no team
      "Ben Clarke",
      "Dan Cooper",
      "Priya Gurung",
      "Sita Gurung",
      "Tom Hughes", // inactive without a team is not lifted
    ])
  })
})

describe("Staff directory", () => {
  it("lists everyone in the people order with emails and one menu per row", () => {
    render(directory())
    expect(names()).toEqual([
      "Josh Patel",
      "Anil Thapa",
      "Ben Clarke",
      "Dan Cooper",
      "Priya Gurung",
      "Sita Gurung",
      "Tom Hughes",
    ])
    const table = screen.getByRole("table", { name: "Staff" })
    expect(within(table).getByText("priya.gurung@nabalens.test")).toBeTruthy()
    // No inline row buttons: each row's only button is its menu.
    const rows = within(table).getAllByRole("row").slice(1)
    for (const row of rows) {
      const buttons = within(row).getAllByRole("button")
      expect(buttons).toHaveLength(1)
      expect(buttons[0].getAttribute("aria-label")).toMatch(
        /^More actions for /
      )
    }
    expect(
      screen.getByText("7 shown · 5 active · 1 invited · 1 inactive")
    ).toBeTruthy()
  })

  it("says how many active people have no team", () => {
    render(directory())
    expect(screen.getByText("1 person has no team")).toBeTruthy()
  })

  it("marks effective venue managers", () => {
    const dan = staff.find((m) => m.displayName === "Dan Cooper")!
    render(
      directory({
        grants: [
          { staffId: dan.id, venueId: RAILWAY.id, venueName: RAILWAY.name },
        ],
      })
    )
    const row = within(screen.getByRole("table", { name: "Staff" }))
      .getByRole("link", { name: "Dan Cooper" })
      .closest("tr")!
    expect(within(row).getByText("Venue manager")).toBeTruthy()
  })

  it("marks venue manager accounts even without an effective grant", () => {
    const manager = person("Mia Rai", { status: "active" })
    render(
      <StaffDirectory
        staff={[...staff, { ...manager, role: "manager" }]}
        venues={[RAILWAY, BELL]}
        grants={[]}
        maxAvatarBytes={5 << 20}
      />
    )
    const table = within(screen.getByRole("table", { name: "Staff" }))
    const row = table.getByRole("link", { name: "Mia Rai" }).closest("tr")!
    expect(within(row).getByText("Venue manager")).toBeTruthy()
    const other = table.getByRole("link", { name: "Ben Clarke" }).closest("tr")!
    expect(within(other).queryByText("Venue manager")).toBeNull()
  })

  it("filters only when applied, explains an empty result and clears", async () => {
    const user = userEvent.setup()
    render(directory())
    await user.click(screen.getByRole("combobox", { name: "Status" }))
    await user.click(await screen.findByRole("option", { name: "Inactive" }))
    await user.click(screen.getByRole("combobox", { name: "Team" }))
    await user.click(
      await screen.findByRole("option", { name: "Back of house" })
    )
    expect(names()).toHaveLength(7)

    await user.click(screen.getByRole("button", { name: "Apply filters" }))
    expect(screen.getByText("Nothing matches these filters.")).toBeTruthy()
    expect(
      screen.getByText(
        "Showing inactive staff in back of house. Try all statuses."
      )
    ).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(names()).toHaveLength(7)
  })

  it("searches names and emails", async () => {
    const user = userEvent.setup()
    render(directory())
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "gurung")
    await user.click(screen.getByRole("button", { name: "Apply filters" }))
    expect(names()).toEqual(["Priya Gurung", "Sita Gurung"])
    expect(screen.getByText("2 shown")).toBeTruthy()
  })
})

async function openRowMenu(name: string) {
  const user = userEvent.setup()
  const table = screen.getByRole("table", { name: "Staff" })
  await user.click(
    within(table).getByRole("button", { name: `More actions for ${name}` })
  )
  return within(await screen.findByRole("menu"))
}

describe("Deactivate?", () => {
  it("says a manager's grant ends and isn't restored, then confirms", async () => {
    setStaffActiveAction.mockResolvedValue({ ok: true, status: "inactive" })
    const dan = staff.find((m) => m.displayName === "Dan Cooper")!
    render(
      directory({
        grants: [
          { staffId: dan.id, venueId: RAILWAY.id, venueName: RAILWAY.name },
        ],
      })
    )
    const menu = await openRowMenu("Dan Cooper")
    await userEvent
      .setup()
      .click(menu.getByRole("menuitem", { name: "Deactivate" }))
    const dialog = within(await screen.findByRole("alertdialog"))
    expect(
      dialog.getByRole("heading", { name: "Deactivate Dan Cooper?" })
    ).toBeTruthy()
    expect(
      dialog.getByText(
        `Dan's venue manager grant at ${RAILWAY.name} ends: "Ended: account deactivated". Reactivating doesn't restore it.`
      )
    ).toBeTruthy()
    await act(async () => {
      await userEvent
        .setup()
        .click(dialog.getByRole("button", { name: "Deactivate" }))
    })
    expect(setStaffActiveAction).toHaveBeenCalledWith(dan.id, false)
    expect(
      await screen.findByText(
        "Dan Cooper is inactive. Dan's uploads stay in the library."
      )
    ).toBeTruthy()
  })

  it("keeps the dialog open and says nothing changed when the request fails", async () => {
    setStaffActiveAction.mockRejectedValue(new Error("offline"))
    render(directory())
    const menu = await openRowMenu("Ben Clarke")
    await userEvent
      .setup()
      .click(menu.getByRole("menuitem", { name: "Deactivate" }))
    const dialog = within(await screen.findByRole("alertdialog"))
    expect(dialog.queryByText(/venue manager grant/)).toBeNull()
    await act(async () => {
      await userEvent
        .setup()
        .click(dialog.getByRole("button", { name: "Deactivate" }))
    })
    expect(dialog.getByText("Couldn't deactivate")).toBeTruthy()
    expect(
      dialog.getByText(
        "Nothing changed. Ben still has access. Check your connection and try again."
      )
    ).toBeTruthy()
  })
})

describe("Edit staff details", () => {
  it("spells out what a venue move ends before saving", async () => {
    updateStaffAccountAction.mockResolvedValue({ ok: true })
    const dan = staff.find((m) => m.displayName === "Dan Cooper")!
    render(
      directory({
        grants: [
          { staffId: dan.id, venueId: RAILWAY.id, venueName: RAILWAY.name },
        ],
      })
    )
    const user = userEvent.setup()
    const menu = await openRowMenu("Dan Cooper")
    await user.click(menu.getByRole("menuitem", { name: "Edit details" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect(
      dialog.getByRole("heading", { name: "Edit Dan Cooper's details" })
    ).toBeTruthy()
    expect(
      dialog.getByText("Email and role can't be changed here.")
    ).toBeTruthy()

    await user.click(dialog.getByRole("combobox", { name: "Venue" }))
    await user.click(await screen.findByRole("option", { name: BELL.name }))
    expect(dialog.getByText(`Moving Dan Cooper to ${BELL.name}`)).toBeTruthy()
    expect(
      dialog.getByText(
        `Dan's venue manager grant at ${RAILWAY.name} ends: "Ended: moved to another venue". It doesn't move with Dan.`
      )
    ).toBeTruthy()
    expect(
      dialog.getByText(
        new RegExp(
          `^Dan's [A-Z][a-z]+ target at ${BELL.name} starts as Needs setup\\. ${BELL.name} has no venue manager, so an admin sets it\\.$`
        )
      )
    ).toBeTruthy()

    await act(async () => {
      await user.click(dialog.getByRole("button", { name: "Save changes" }))
    })
    expect(updateStaffAccountAction).toHaveBeenCalledWith(
      dan.id,
      expect.objectContaining({ venueId: BELL.id })
    )
    expect(
      await screen.findByText(
        `Dan Cooper now works at ${BELL.name}. The manager grant at ${RAILWAY.name} ended: Ended: moved to another venue.`
      )
    ).toBeTruthy()
  })

  it("doesn't say a managed venue lacks a manager", async () => {
    const dan = staff.find((m) => m.displayName === "Dan Cooper")!
    const ben = staff.find((m) => m.displayName === "Ben Clarke")!
    render(
      directory({
        grants: [
          { staffId: dan.id, venueId: RAILWAY.id, venueName: RAILWAY.name },
          { staffId: ben.id, venueId: BELL.id, venueName: BELL.name },
        ],
      })
    )
    const user = userEvent.setup()
    const menu = await openRowMenu("Dan Cooper")
    await user.click(menu.getByRole("menuitem", { name: "Edit details" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.click(dialog.getByRole("combobox", { name: "Venue" }))
    await user.click(await screen.findByRole("option", { name: BELL.name }))
    expect(
      dialog.getByText(
        new RegExp(
          `^Dan's [A-Z][a-z]+ target at ${BELL.name} starts as Needs setup\\.$`
        )
      )
    ).toBeTruthy()
    expect(dialog.queryByText(/has no venue manager/)).toBeNull()
  })

  it("asks before dropping unsaved edits", async () => {
    render(directory())
    const user = userEvent.setup()
    const menu = await openRowMenu("Priya Gurung")
    await user.click(menu.getByRole("menuitem", { name: "Edit details" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.type(dialog.getByLabelText(/Job title/), "Chef de partie")
    await user.click(dialog.getByRole("radio", { name: "Front of house" }))
    await user.click(dialog.getByRole("button", { name: "Cancel" }))

    const confirm = within(await screen.findByRole("alertdialog"))
    expect(confirm.getByText("Leave without saving?")).toBeTruthy()
    expect(
      confirm.getByText(
        "Your changes to Priya's job title and team aren't saved yet."
      )
    ).toBeTruthy()
    await user.click(confirm.getByRole("button", { name: "Keep editing" }))
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(updateStaffAccountAction).not.toHaveBeenCalled()
  })
})
