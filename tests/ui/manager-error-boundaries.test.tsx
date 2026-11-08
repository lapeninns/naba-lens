// @vitest-environment jsdom
// The workspace's segment error boundaries: each names the page and what
// failed, keeps Try again (retry plus a server refresh), and detail pages keep
// their way back.
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentType } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}))

import ManagerAccountError from "@/app/manager/account/error"
import ManagerError from "@/app/manager/error"
import ManagerMenuItemError from "@/app/manager/menu/[itemId]/error"
import ManagerMenuError from "@/app/manager/menu/error"
import ManagerContributorError from "@/app/manager/review/contributors/[staffId]/error"
import ManagerReviewError from "@/app/manager/review/error"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"

type Boundary = ComponentType<{ error: unknown; retry: () => void }>

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const CASES: [string, Boundary, string, string, [string, string] | null][] = [
  ["Overview", ManagerError, "Overview", "We couldn't load the overview", null],
  [
    "Review",
    ManagerReviewError,
    "Review",
    "We couldn't load photos for review",
    null,
  ],
  [
    "Contributor",
    ManagerContributorError,
    "Contributor",
    "We couldn't load this contributor's photos",
    [REVIEW_COPY.backToReview, "/manager/review"],
  ],
  ["Menu", ManagerMenuError, "Menu", "We couldn't load the menu", null],
  [
    "Menu item",
    ManagerMenuItemError,
    "Menu item",
    "We couldn't load this menu item",
    ["Go to Menu", "/manager/menu"],
  ],
  [
    "Account",
    ManagerAccountError,
    "Account",
    "We couldn't load your account",
    null,
  ],
]

describe("manager error boundaries", () => {
  it.each(CASES)(
    "%s names its own content and offers Try again",
    async (_, Boundary, heading, failed, back) => {
      const user = userEvent.setup()
      const retry = vi.fn()
      render(<Boundary error={new Error("boom")} retry={retry} />)
      expect(
        screen.getByRole("heading", { level: 1, name: heading })
      ).toBeTruthy()
      const alert = screen.getByRole("alert")
      expect(alert.textContent).toContain(failed)
      expect(alert.textContent).not.toContain("menu photos")
      expect(alert.textContent).toContain(
        "Check your connection and try again."
      )

      await user.click(screen.getByRole("button", { name: "Try again" }))
      expect(retry).toHaveBeenCalledTimes(1)
      expect(nav.refresh).toHaveBeenCalledTimes(1)

      const links = screen.queryAllByRole("link")
      if (back) {
        expect(links).toHaveLength(1)
        expect(links[0].textContent).toBe(back[0])
        expect(links[0].getAttribute("href")).toBe(back[1])
      } else {
        expect(links).toHaveLength(0)
      }
    }
  )

  it("shows the request ID of a server error", () => {
    const error = Object.assign(new Error("hidden"), { digest: "abc123" })
    render(<ManagerMenuError error={error} retry={vi.fn()} />)
    expect(screen.getByText("Request ID abc123")).toBeTruthy()
    expect(screen.queryByText("hidden")).toBeNull()
  })
})
