// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConfirmDeleteDialog } from "@/components/nabalens"

afterEach(cleanup)

describe("S13 delete this photo", () => {
  const confirm = (props: Partial<Parameters<typeof ConfirmDeleteDialog>[0]>) =>
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => ({ ok: true })}
        {...props}
      />
    )

  it("explains a photo that counts this month", () => {
    confirm({
      impact: {
        kind: "counts",
        taskName: "Chef's Specials",
        monthName: "November",
      },
    })
    expect(
      screen.getByRole("heading", { name: "Delete this photo?" })
    ).toBeTruthy()
    expect(
      screen.getByText(
        "It's removed from your profile and from Photos. It stops counting for Chef's Specials and your November target, and the task reopens. When backups are enabled, copies are retained indefinitely for recovery. Previously downloaded copies cannot be recalled."
      )
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Keep photo" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()
  })

  it("explains a closed past month", () => {
    confirm({ impact: { kind: "past", monthName: "October 2026" } })
    expect(
      screen.getByText(
        "It's removed from your profile and from Photos. October 2026 is closed, so your history keeps a note that a photo was removed and the month's result doesn't change. When backups are enabled, copies are retained indefinitely for recovery. Previously downloaded copies cannot be recalled."
      )
    ).toBeTruthy()
  })

  it("explains a photo that is not counting", () => {
    confirm({ impact: { kind: "none" } })
    expect(
      screen.getByText(
        "It's removed from your profile and from Photos. It isn't counting toward any task. When backups are enabled, copies are retained indefinitely for recovery. Previously downloaded copies cannot be recalled."
      )
    ).toBeTruthy()
  })

  it("warns that a dish may need a new photo when its accepted photo goes", () => {
    confirm({ impact: { kind: "menu", dishes: ["Soup"] } })
    expect(
      screen.getByText(
        "It's removed from your profile and from Photos. It's the accepted menu photo for Soup, so that dish may need a new photo. When backups are enabled, copies are retained indefinitely for recovery. Previously downloaded copies cannot be recalled."
      )
    ).toBeTruthy()
    cleanup()
    confirm({ impact: { kind: "menu", dishes: ["Soup", "Pie", "Momo (Veg)"] } })
    expect(
      screen.getByText(
        /accepted menu photo for Soup, Pie and Momo \(Veg\), so those dishes may need a new photo\./
      )
    ).toBeTruthy()
  })

  it("claims nothing about tasks when the impact is unknown", () => {
    confirm({})
    expect(
      screen.getByText(
        "It's removed from your profile and from Photos. When backups are enabled, copies are retained indefinitely for recovery. Previously downloaded copies cannot be recalled."
      )
    ).toBeTruthy()
  })

  it("names the owner when an admin removes a file", () => {
    confirm({
      ownerName: "Priya Gurung",
      impact: {
        kind: "counts",
        taskName: "Chef's Specials",
        monthName: "November",
      },
    })
    expect(
      screen.getByText(
        "Remove this file from Priya's profile, Photos and the library? It stops counting for Chef's Specials and Priya's November target. When backups are enabled, copies are retained indefinitely for recovery. Previously downloaded copies cannot be recalled."
      )
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Keep file" })).toBeTruthy()
  })

  it("shows Deleting… and ignores repeat presses while busy", async () => {
    let settle: () => void = () => {}
    const onConfirm = vi.fn(
      () => new Promise<{ ok: true }>((r) => (settle = () => r({ ok: true })))
    )
    const onOpenChange = vi.fn()
    confirm({ onConfirm, onOpenChange })
    await userEvent.click(screen.getByRole("button", { name: "Delete" }))
    const busy = screen.getByRole("button", { name: "Deleting…" })
    expect(busy.getAttribute("aria-busy")).toBe("true")
    expect(
      (screen.getByRole("button", { name: "Keep photo" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    await userEvent.click(busy)
    expect(onConfirm).toHaveBeenCalledOnce()
    settle()
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
