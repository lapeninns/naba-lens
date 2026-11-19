// @vitest-environment jsdom
import * as React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { EditProfileDialog } from "@/components/nabalens/edit-profile-dialog"

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
})
