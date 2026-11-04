// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  LeaveGuard,
  leaveCopy,
  useLeaveGuard,
} from "@/components/nabalens/shell/leave-guard"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

afterEach(() => {
  cleanup()
  push.mockClear()
})

function Queue({ active, stop }: { active: number; stop: () => void }) {
  useLeaveGuard(active, stop)
  return null
}

function setup(active: number, queues = 1) {
  const stop = vi.fn()
  const loggedOut = vi.fn((e: React.FormEvent) => e.preventDefault())
  const followed = vi.fn((e: React.MouseEvent) => e.preventDefault())
  render(
    <LeaveGuard>
      {Array.from({ length: queues }, (_, i) => (
        <Queue key={i} active={active} stop={stop} />
      ))}
      <form data-logout onSubmit={loggedOut}>
        <button type="submit">Log out</button>
      </form>
      <form onSubmit={(e) => e.preventDefault()}>
        <button type="submit">Save</button>
      </form>
      <a href="/login" onClick={followed}>
        Elsewhere
      </a>
      {/* A plain anchor: the guard reads the DOM click, as it does for Link. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/staff/people" onClick={followed}>
        People
      </a>
    </LeaveGuard>
  )
  return { user: userEvent.setup(), stop, loggedOut, followed }
}

describe("LeaveGuard", () => {
  it("logs out and follows links without asking when nothing is uploading", async () => {
    const { user, loggedOut, followed } = setup(0)
    await user.click(screen.getByRole("button", { name: "Log out" }))
    expect(loggedOut).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("link", { name: "Elsewhere" }))
    expect(followed).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("asks before Log out while uploads run; Keep uploading stays and returns focus", async () => {
    const { user, stop, loggedOut } = setup(2)
    const logOut = screen.getByRole("button", { name: "Log out" })
    await user.click(logOut)
    expect(loggedOut).not.toHaveBeenCalled()

    const dialog = await screen.findByRole("alertdialog", {
      name: "Log out now?",
    })
    expect(dialog.textContent).toContain(
      "Leave now and 2 uploads stop. Finished photos stay uploaded."
    )
    const keep = screen.getByRole("button", { name: "Keep uploading" })
    await waitFor(() => expect(document.activeElement).toBe(keep))
    expect(keep.dataset.variant).toBe("primary")
    // The safe button is named, never "Cancel".
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()

    await user.click(keep)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(logOut))
    expect(stop).not.toHaveBeenCalled()
    expect(loggedOut).not.toHaveBeenCalled()
  })

  it("Log out anyway stops the uploads, then logs out", async () => {
    const { user, stop, loggedOut } = setup(1, 2)
    await user.click(screen.getByRole("button", { name: "Log out" }))
    const dialog = await screen.findByRole("alertdialog", {
      name: "Log out now?",
    })
    expect(dialog.textContent).toContain("Leave now and 2 uploads stop.")
    await user.click(screen.getByRole("button", { name: "Log out anyway" }))
    expect(stop).toHaveBeenCalledTimes(2)
    expect(loggedOut).toHaveBeenCalledTimes(1)
  })

  it("Escape keeps uploading", async () => {
    const { user, loggedOut } = setup(1)
    await user.click(screen.getByRole("button", { name: "Log out" }))
    await screen.findByRole("alertdialog")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(loggedOut).not.toHaveBeenCalled()
  })

  it("asks before a link out of /staff, not between staff pages or for other forms", async () => {
    const { user, stop, followed } = setup(1)
    await user.click(screen.getByRole("button", { name: "Save" }))
    await user.click(screen.getByRole("link", { name: "People" }))
    expect(followed).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alertdialog")).toBeNull()

    await user.click(screen.getByRole("link", { name: "Elsewhere" }))
    expect(followed).toHaveBeenCalledTimes(1)
    const dialog = await screen.findByRole("alertdialog", {
      name: "Leave now?",
    })
    expect(dialog.textContent).toContain(
      "Leave now and 1 upload stops. Finished photos stay uploaded."
    )
    await user.click(screen.getByRole("button", { name: "Leave anyway" }))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(followed).toHaveBeenCalledTimes(2)
  })

  it("does nothing outside the guard", () => {
    const stop = vi.fn()
    render(<Queue active={3} stop={stop} />)
    expect(stop).not.toHaveBeenCalled()
  })
})

describe("leaveCopy", () => {
  it("uses the deck's words", () => {
    expect(leaveCopy("logout", 2)).toEqual({
      title: "Log out now?",
      body: "Leave now and 2 uploads stop. Finished photos stay uploaded.",
      leave: "Log out anyway",
      stay: "Keep uploading",
    })
    expect(leaveCopy("leave", 2)).toMatchObject({
      title: "Leave now?",
      leave: "Leave anyway",
      stay: "Keep uploading",
    })
  })
})
