// @vitest-environment jsdom
// The staff account header must show the status the server confirmed as soon as
// the action returns, without waiting for the action's re-render of the page.
// That re-render re-reads Auth, media and venues and arrived after 30 s on a
// loaded machine (acceptance-map run, mobile e2e). Here the page props never
// change, which is the worst case of that delay.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { StaffMember } from "@/components/nabalens"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}))

const setStaffActiveAction = vi.fn()
vi.mock("@/app/admin/staff/actions", () => ({
  setStaffActiveAction: (...args: unknown[]) => setStaffActiveAction(...args),
  resendInvitationAction: vi.fn(async () => ({ ok: true })),
  updateStaffAccountAction: vi.fn(async () => ({ ok: true })),
}))

import { AccountHeader } from "@/app/admin/staff/[id]/account-header"

const member = (status: StaffMember["status"]): StaffMember => ({
  id: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
  displayName: "TEST Sam",
  avatarUrl: null,
  jobTitle: "Bartender",
  venueId: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11",
  venueName: "TEST Venue",
  email: "sam@nabalens.test",
  status,
})

function header(status: StaffMember["status"]) {
  return (
    <AccountHeader
      member={member(status)}
      venueActive
      venues={[]}
      maxAvatarBytes={5 * 1024 * 1024}
    />
  )
}

const statusText = () =>
  ["Active", "Invited", "Inactive"].filter(
    (text) => screen.queryAllByText(text, { exact: true }).length > 0
  )

beforeEach(() => {
  refresh.mockClear()
  setStaffActiveAction.mockReset()
})
afterEach(cleanup)

describe("AccountHeader status after an activation change", () => {
  it("shows Inactive and Reactivate as soon as deactivation is confirmed", async () => {
    setStaffActiveAction.mockResolvedValue({ ok: true, status: "inactive" })
    render(header("active"))
    expect(statusText()).toEqual(["Active"])

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }))
    const dialog = await screen.findByRole("alertdialog")
    await act(async () => {
      fireEvent.click(
        Array.from(dialog.querySelectorAll("button")).find(
          (b) => b.textContent === "Deactivate"
        )!
      )
    })

    expect(setStaffActiveAction).toHaveBeenCalledWith(
      member("active").id,
      false
    )
    expect(await screen.findByText(/is deactivated/)).toBeTruthy()
    // The props still say "active": the confirmed status wins until they change.
    expect(statusText()).toEqual(["Inactive"])
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull()
    expect(refresh).toHaveBeenCalled()
  })

  it("shows the server's status after reactivation (Invited if never signed in)", async () => {
    setStaffActiveAction.mockResolvedValue({ ok: true, status: "invited" })
    render(header("inactive"))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reactivate" }))
    })
    expect(await screen.findByText(/can sign in again/)).toBeTruthy()
    expect(statusText()).toEqual(["Invited"])
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Resend invitation" })
    ).toBeTruthy()
  })

  it("a refused change leaves the status alone", async () => {
    setStaffActiveAction.mockResolvedValue({ ok: false, error: "Nope." })
    render(header("active"))
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }))
    const dialog = await screen.findByRole("alertdialog")
    await act(async () => {
      fireEvent.click(
        Array.from(dialog.querySelectorAll("button")).find(
          (b) => b.textContent === "Deactivate"
        )!
      )
    })
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(statusText()).toEqual(["Active"])
  })

  it("fresh server props take over from the confirmed status", async () => {
    setStaffActiveAction.mockResolvedValue({ ok: true, status: "inactive" })
    const view = render(header("active"))
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }))
    const dialog = await screen.findByRole("alertdialog")
    await act(async () => {
      fireEvent.click(
        Array.from(dialog.querySelectorAll("button")).find(
          (b) => b.textContent === "Deactivate"
        )!
      )
    })
    expect(statusText()).toEqual(["Inactive"])

    // The re-render arrives; later another admin reactivates and it shows.
    view.rerender(header("inactive"))
    expect(statusText()).toEqual(["Inactive"])
    view.rerender(header("active"))
    expect(statusText()).toEqual(["Active"])
  })
})
