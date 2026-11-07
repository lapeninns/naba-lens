// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ManagerAccountForm } from "@/components/nabalens/manager/account-form"
import type { ActionResult } from "@/components/nabalens/types"

afterEach(() => cleanup())

function setup(
  onSave: (input: { displayName: string }) => Promise<ActionResult> = vi
    .fn()
    .mockResolvedValue({ ok: true })
) {
  const user = userEvent.setup()
  render(
    <ManagerAccountForm
      displayName="Mina Patel"
      email="mina@example.test"
      venueName="The Railway"
      onSave={onSave}
    />
  )
  const input = screen.getByLabelText("Display name") as HTMLInputElement
  return { user, input, onSave }
}

describe("ManagerAccountForm", () => {
  it("shows email and venue read-only, with the admin note", () => {
    setup()
    expect(screen.getByText("mina@example.test")).toBeTruthy()
    expect(screen.getByText("The Railway")).toBeTruthy()
    expect(
      screen.getByText("Only an admin can change your venue.")
    ).toBeTruthy()
    // Only the display name is a field.
    expect(screen.getAllByRole("textbox")).toEqual([
      screen.getByLabelText("Display name"),
    ])
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it("refuses an empty name without saving", async () => {
    const { user, input, onSave } = setup()
    await user.clear(input)
    await user.type(input, "   ")
    await user.click(screen.getByRole("button", { name: "Save name" }))
    expect(onSave).not.toHaveBeenCalled()
    expect(
      screen.getByText("Enter a name of up to 80 characters.")
    ).toBeTruthy()
    expect(input.getAttribute("aria-invalid")).toBe("true")
  })

  it("caps the name at 80 characters", () => {
    const { input } = setup()
    expect(input.maxLength).toBe(80)
  })

  it("saves the trimmed name and confirms", async () => {
    const { user, input, onSave } = setup()
    await user.clear(input)
    await user.type(input, "  Mina P  ")
    await user.click(screen.getByRole("button", { name: "Save name" }))
    expect(onSave).toHaveBeenCalledWith({ displayName: "Mina P" })
    expect((await screen.findByRole("status")).textContent).toContain(
      "Your name is saved."
    )
    expect(input.value).toBe("Mina P")
  })

  it("shows the server's field error", async () => {
    const onSave = vi.fn().mockResolvedValue({
      ok: false,
      error: "Check the highlighted field.",
      fieldErrors: { displayName: "Enter a name of up to 80 characters." },
    })
    const { user } = setup(onSave)
    await user.click(screen.getByRole("button", { name: "Save name" }))
    expect(await screen.findByText("Check the highlighted field.")).toBeTruthy()
    expect(
      screen.getByText("Enter a name of up to 80 characters.")
    ).toBeTruthy()
  })

  it("reports a failed save", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("network"))
    const { user } = setup(onSave)
    await user.click(screen.getByRole("button", { name: "Save name" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Your name could not be saved. Try again."
    )
  })

  it("signs out with a form POST to /auth/logout", () => {
    setup()
    const form = screen
      .getByRole("button", { name: "Sign out" })
      .closest("form")
    expect(form?.getAttribute("action")).toBe("/auth/logout")
    expect(form?.getAttribute("method")).toBe("post")
  })
})
