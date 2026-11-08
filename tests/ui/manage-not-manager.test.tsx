// @vitest-environment jsdom
// Legacy /staff/manage without an effective grant. New grants go to venue
// manager accounts only, so the copy must not promise a grant to this staff
// account.
import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const shell = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({
    children,
    ...props
  }: { children: ReactNode } & Record<string, unknown>) => {
    shell.props = props
    return <main>{children}</main>
  },
}))
vi.mock("@/app/staff/_shell/shell-status", () => ({
  currentStaffShell: vi.fn(async () => ({
    canManage: false,
    todoCount: 2,
    reviewCount: undefined,
    avatarUrl: "/api/avatars/me",
  })),
}))

import { NotManagerPage } from "@/app/staff/manage/_shared/frame"

afterEach(cleanup)

describe("NotManagerPage", () => {
  it("names the real way in: a venue manager account", async () => {
    render(await NotManagerPage({ viewerName: "TEST Sam" }))
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

  it("keeps Home's badge and the avatar in the shell", async () => {
    render(await NotManagerPage({ viewerName: "TEST Sam" }))
    expect(shell.props).toMatchObject({
      variant: "staff",
      todoCount: 2,
      avatarUrl: "/api/avatars/me",
    })
  })
})
