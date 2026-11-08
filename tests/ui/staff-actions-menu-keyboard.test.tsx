// @vitest-environment jsdom
// The Staff "More actions" menu from the keyboard: Enter, Space and ArrowDown
// open it with the first item focused, arrows move between items, Escape
// closes it and puts focus back on the trigger. (Tab closing the menu is
// standard menu behaviour.) Focus already moved correctly; what failed was
// seeing it, so each item also draws the focus outline.
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { StaffMember } from "@/components/nabalens"
import { StaffActionsMenu } from "@/components/nabalens/staff-directory-table"

const member: StaffMember = {
  id: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
  displayName: "TEST Sam",
  avatarUrl: null,
  jobTitle: null,
  venueId: null,
  venueName: null,
  email: "sam@nabalens.test",
  status: "invited",
}

function renderMenu() {
  const actions = {
    onEdit: vi.fn(),
    onResendInvite: vi.fn(),
    onSetActive: vi.fn(),
  }
  render(<StaffActionsMenu member={member} {...actions} />)
  const trigger = screen.getByRole("button", {
    name: "More actions for TEST Sam",
  })
  act(() => trigger.focus())
  return { trigger, actions }
}

afterEach(cleanup)

describe("More actions menu from the keyboard", () => {
  it.each(["{Enter}", " ", "{ArrowDown}"])(
    "%s opens it with the first item focused",
    async (key) => {
      renderMenu()
      await userEvent.setup().keyboard(key)
      const menu = await screen.findByRole("menu")
      const first = within(menu).getAllByRole("menuitem")[0]
      await vi.waitFor(() => expect(document.activeElement).toBe(first))
      expect(first.textContent).toBe("Edit details")
    }
  )

  it("arrows move between items and Enter runs the focused one", async () => {
    const { actions } = renderMenu()
    const user = userEvent.setup()
    await user.keyboard("{Enter}")
    const menu = await screen.findByRole("menu")
    const items = within(menu).getAllByRole("menuitem")
    await vi.waitFor(() => expect(document.activeElement).toBe(items[0]))
    await user.keyboard("{ArrowDown}")
    expect(document.activeElement).toBe(items[1])
    expect(items[1].textContent).toBe("Resend invitation")
    await user.keyboard("{ArrowUp}")
    expect(document.activeElement).toBe(items[0])
    await user.keyboard("{ArrowDown}{Enter}")
    expect(actions.onResendInvite).toHaveBeenCalledWith(member)
  })

  it("every item draws the focus outline (the shared grey tint is ~1.2:1 on white)", async () => {
    renderMenu()
    await userEvent.setup().keyboard("{Enter}")
    const items = within(await screen.findByRole("menu")).getAllByRole(
      "menuitem"
    )
    expect(items.length).toBeGreaterThan(2)
    for (const item of items) {
      expect(item.className).toContain("focus-visible:outline-focus")
      expect(item.className).toContain("focus-visible:outline-solid")
      expect(item.className).toContain("focus-visible:outline-3")
    }
  })

  it("Escape closes it and returns focus to the trigger", async () => {
    const { trigger } = renderMenu()
    const user = userEvent.setup()
    await user.keyboard("{Enter}")
    await screen.findByRole("menu")
    await user.keyboard("{Escape}")
    await vi.waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})
