// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => nav }))

import {
  VenueAccessUnavailable,
  VenueAccessUnavailablePage,
} from "@/components/nabalens/manager/venue-access-unavailable"

afterEach(() => cleanup())
beforeEach(() => nav.refresh.mockReset())

const BODY =
  "Your account doesn't have access to a venue workspace right now. Ask an admin to check your venue access."

describe("VenueAccessUnavailable", () => {
  it.each([
    ["venue_inactive", "Your venue is not active."],
    ["no_grant", "Your venue access has ended."],
    ["venue_mismatch", "Your venue access has ended."],
  ] as const)("explains %s", (reason, line) => {
    render(<VenueAccessUnavailable reason={reason} />)
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Venue access unavailable",
      })
    ).toBeTruthy()
    expect(screen.getByText(BODY)).toBeTruthy()
    expect(screen.getByText(line)).toBeTruthy()
  })

  it("focuses the heading on mount", () => {
    render(<VenueAccessUnavailable reason="no_grant" />)
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Venue access unavailable" })
    )
  })

  it("signs out with a form POST to /auth/logout", () => {
    render(<VenueAccessUnavailable reason="no_grant" />)
    const button = screen.getByRole("button", { name: "Sign out" })
    const form = button.closest("form")
    expect(button.getAttribute("type")).toBe("submit")
    expect(form?.getAttribute("action")).toBe("/auth/logout")
    expect(form?.getAttribute("method")).toBe("post")
  })

  it("refreshes once inside the shell so the layout drops the nav", () => {
    const { rerender } = render(
      <VenueAccessUnavailable reason="no_grant" refreshShell />
    )
    rerender(<VenueAccessUnavailable reason="no_grant" refreshShell />)
    expect(nav.refresh).toHaveBeenCalledTimes(1)
  })

  it("never refreshes as the layout's own page", () => {
    render(<VenueAccessUnavailable reason="no_grant" />)
    render(<VenueAccessUnavailablePage reason="no_grant" />)
    expect(nav.refresh).not.toHaveBeenCalled()
  })

  it("renders the page with no navigation or workspace links", () => {
    render(<VenueAccessUnavailablePage reason="venue_inactive" />)
    expect(screen.queryByRole("navigation")).toBeNull()
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByRole("main")).toBeTruthy()
  })
})
