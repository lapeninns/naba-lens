// @vitest-environment jsdom
// Legacy /staff/manage without an effective grant. New grants go to venue
// manager accounts only, so the copy must not promise a grant to this staff
// account.
import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/app/_media/actions", () => ({ logout: vi.fn() }))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

import { NotManagerPage } from "@/app/staff/manage/_shared/frame"

afterEach(cleanup)

describe("NotManagerPage", () => {
  it("names the real way in: a venue manager account", () => {
    render(<NotManagerPage viewerName="TEST Sam" />)
    expect(
      screen.getByRole("heading", { name: "Manage isn't available" })
    ).toBeTruthy()
    const main = screen.getByRole("main")
    expect(main.textContent).toContain(
      "Manage is for venue managers. To manage your venue, ask an admin to change your account to a venue manager account."
    )
    expect(main.textContent).not.toMatch(/make you a venue manager/)
    expect(
      screen.getByRole("link", { name: "Go to Home" }).getAttribute("href")
    ).toBe("/staff/tasks")
  })
})
