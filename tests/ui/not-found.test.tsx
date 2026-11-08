// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: async () => ({ displayName: "Asha", role: "staff" }),
  requireActiveAdmin: async () => ({ displayName: "Ravi", role: "admin" }),
}))

import AdminNotFound from "@/app/admin/not-found"
import RootNotFound, { metadata } from "@/app/not-found"
import StaffNotFound from "@/app/staff/not-found"
import { AppShell } from "@/components/nabalens/app-shell"
import {
  NOT_FOUND_COPY,
  NotFoundCard,
} from "@/components/nabalens/not-found-card"

afterEach(cleanup)

type Element = { type: unknown; props: Record<string, unknown> }
const cardIn = (shell: Element) =>
  (shell.props.children as Element).props.children as Element

describe("branded not-found pages", () => {
  it("an unknown URL says what happened and offers one way back, by role via /", () => {
    render(<RootNotFound />)
    expect(
      screen.getByRole("heading", { level: 1, name: NOT_FOUND_COPY.title })
    ).toBeTruthy()
    expect(screen.getByText(NOT_FOUND_COPY.body)).toBeTruthy()
    expect(screen.getByText("Naba-Lens")).toBeTruthy()
    const links = screen.getAllByRole("link")
    expect(links).toHaveLength(1)
    expect(links[0].textContent).toBe("Go to Naba-Lens")
    expect(links[0].getAttribute("href")).toBe("/")
    expect(metadata.title).toBe("Page not found · Naba-Lens")
  })

  it("the way back is a 52px primary button", () => {
    render(<NotFoundCard backHref="/staff/tasks" backLabel="Go to Home" />)
    const back = screen.getByRole("link", { name: "Go to Home" })
    expect(back.className).toContain("min-h-13")
    // The screen's one blue (accent) button.
    expect(back.className).toContain("bg-accent")
  })

  it("a missing staff page keeps the staff navigation and goes back to Home", async () => {
    const page = (await StaffNotFound()) as unknown as Element
    expect(page.type).toBe(AppShell)
    expect(page.props).toMatchObject({ variant: "staff", userName: "Asha" })
    expect(cardIn(page)).toMatchObject({
      type: NotFoundCard,
      props: { backHref: "/staff/tasks", backLabel: "Go to Home" },
    })
  })

  it("a missing admin page keeps the admin navigation and goes back to Content", async () => {
    const page = (await AdminNotFound()) as unknown as Element
    expect(page.type).toBe(AppShell)
    expect(page.props).toMatchObject({ variant: "admin", userName: "Ravi" })
    expect(cardIn(page)).toMatchObject({
      type: NotFoundCard,
      props: { backHref: "/admin", backLabel: "Go to Content" },
    })
  })
})
