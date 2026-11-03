// @vitest-environment jsdom
import * as React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

import { EditStaffDialog } from "@/app/admin/staff/edit-staff-dialog"
import { EditProfileDialog } from "@/components/nabalens/edit-profile-dialog"
import { InviteStaffDialog } from "@/components/nabalens/invite-staff-dialog"

const initial = {
  displayName: "TEST Colleague",
  avatarUrl: null,
  department: "foh" as const,
}
afterEach(cleanup)

describe("department assignment form", () => {
  it("only offers department assignment in the admin form and sends clearing explicitly", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true })
    render(
      <EditProfileDialog
        open
        variant="admin"
        initial={initial}
        venues={[]}
        maxAvatarBytes={4 << 20}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("combobox", { name: "Department" }))
    await user.click(await screen.findByRole("option", { name: "Unassigned" }))
    await user.click(screen.getByRole("button", { name: "Save changes" }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ department: null })
    )
  })

  it("keeps staff profile edits limited to name and photo", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true })
    render(
      <EditProfileDialog
        open
        variant="staff"
        initial={initial}
        maxAvatarBytes={4 << 20}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    )
    expect(screen.queryByRole("combobox", { name: "Department" })).toBeNull()
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Save changes" }))
    expect(onSubmit).toHaveBeenCalledWith({
      displayName: "TEST Colleague",
      avatarFile: null,
    })
  })

  it("the staff edit dialog sends clearing the team explicitly", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true })
    render(
      <EditStaffDialog
        member={{
          id: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
          displayName: "TEST Colleague",
          avatarUrl: null,
          jobTitle: null,
          department: "foh",
          venueId: null,
          venueName: null,
          status: "active",
        }}
        onClose={() => {}}
        venues={[]}
        grant={null}
        maxAvatarBytes={4 << 20}
        onSubmit={onSubmit}
      />
    )
    const user = userEvent.setup()
    expect(
      (
        screen.getByRole("radio", {
          name: "Front of house",
        }) as HTMLInputElement
      ).checked
    ).toBe(true)
    await user.click(screen.getByRole("radio", { name: "Unassigned" }))
    await user.click(screen.getByRole("button", { name: "Save changes" }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ department: null })
    )
  })

  it("invites with the chosen team", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ status: "sent" })
    render(
      <InviteStaffDialog
        open
        onOpenChange={() => {}}
        venues={[
          { id: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11", name: "TEST Venue" },
        ]}
        onSubmit={onSubmit}
      />
    )
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Name"), "TEST Josh")
    await user.type(screen.getByLabelText("Email"), "josh@nabalens.test")
    await user.click(screen.getByRole("combobox", { name: "Venue" }))
    await user.click(await screen.findByRole("option", { name: "TEST Venue" }))
    await user.click(screen.getByRole("radio", { name: "Back of house" }))
    await user.click(screen.getByRole("button", { name: "Send invitation" }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ department: "boh" })
    )
    expect(
      await screen.findByText(
        "TEST Josh can sign in from the link in the email sent to josh@nabalens.test. TEST shows as Invited until then."
      )
    ).toBeTruthy()
  })
})
