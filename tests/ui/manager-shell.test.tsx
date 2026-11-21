// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ pathname: "/manager" }))
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}))

import {
  managerHrefs,
  managerSectionFor,
} from "@/components/nabalens/manager/hrefs"
import { ManagerShell } from "@/components/nabalens/manager/manager-shell"
import { useReviewCount } from "@/components/nabalens/manager/review-count"

beforeEach(() => {
  nav.pathname = "/manager"
})
afterEach(() => cleanup())

function shell(props: { reviewCount?: number } = {}) {
  return render(
    <ManagerShell venueName="The Railway" userName="Mina Patel" {...props}>
      <p>content</p>
    </ManagerShell>
  )
}

// The SideNav (from 1100px), the tabs row (md up) and the tab bar (phones)
// share a name; CSS shows one.
function navs() {
  return screen.getAllByRole("navigation", { name: "Venue workspace" })
}

function links(el: HTMLElement) {
  return within(el)
    .getAllByRole("link")
    .map((a) => [a.textContent?.replace(/,.*$/, ""), a.getAttribute("href")])
}

describe("ManagerShell", () => {
  // S2-MGR: spec §7 navigation.
  it("shows Overview, Review, Album, Requests and Venue at desktop and phone widths", () => {
    shell()
    const found = navs()
    expect(found.map((n) => n.dataset.slot).sort()).toEqual([
      "section-tabs",
      "side-nav",
      "tabbar",
    ])
    for (const el of found) {
      // The SideNav's landmark also holds the wordmark, first (review Z7).
      const items =
        el.dataset.slot === "side-nav" ? links(el).slice(1) : links(el)
      if (el.dataset.slot === "side-nav")
        expect(links(el)[0]).toEqual(["Naba-Lens", "/manager"])
      expect(items).toEqual([
        ["Overview", "/manager"],
        ["Review", "/manager/review"],
        ["Album", "/manager/menu"],
        ["Requests", "/manager/requests"],
        ["Venue", "/manager/venue"],
      ])
    }
  })

  it("names the venue and links the wordmark to /manager and Account", () => {
    shell()
    expect(screen.getByText("The Railway")).toBeTruthy()
    // In the header below 1100px and at the top of the SideNav above it.
    const wordmarks = screen.getAllByRole("link", { name: "Naba-Lens" })
    expect(wordmarks).toHaveLength(2)
    for (const mark of wordmarks)
      expect(mark.getAttribute("href")).toBe("/manager")
    expect(
      screen
        .getByRole("link", { name: "Account: Mina Patel" })
        .getAttribute("href")
    ).toBe("/manager/account")
  })

  it("logs out with a form POST to /auth/logout", () => {
    const { container } = shell()
    const form = container.querySelector("form[data-logout]")
    expect(form?.getAttribute("action")).toBe("/auth/logout")
    expect(form?.getAttribute("method")).toBe("post")
    expect(
      within(form as HTMLElement).getByRole("button", { name: "Log out" })
    ).toBeTruthy()
  })

  it("offers no Add, upload, Photos, People or Me", () => {
    const { container } = shell()
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(screen.queryByRole("button", { name: /add/i })).toBeNull()
    for (const name of [/^add/i, /photos$/i, /^people$/i, /^me\b/i]) {
      expect(screen.queryByRole("link", { name })).toBeNull()
    }
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
    expect(hrefs.filter((h) => h.startsWith("/staff"))).toEqual([])
  })

  it.each([
    ["/manager", "Overview"],
    ["/manager/review", "Review"],
    ["/manager/review/contributors/abc", "Review"],
    ["/manager/menu", "Album"],
    ["/manager/menu/abc", "Album"],
    ["/manager/amenities", "Album"],
    ["/manager/amenities/abc/capture", "Album"],
    ["/manager/album", "Album"],
    ["/manager/requests", "Requests"],
    ["/manager/venue", "Venue"],
    ["/manager/venue/history", "Venue"],
    ["/manager/team", "Venue"],
    ["/manager/exports", "Venue"],
    ["/manager/menu/versions", "Venue"],
    ["/manager/menu/specials", "Venue"],
  ])("marks %s as %s with aria-current", (pathname, label) => {
    nav.pathname = pathname
    shell()
    for (const el of navs()) {
      const current = within(el)
        .getAllByRole("link")
        .filter((a) => a.getAttribute("aria-current") === "page")
        .map((a) => a.textContent)
      expect(current).toEqual([label])
    }
  })

  it("marks no section on Account", () => {
    nav.pathname = "/manager/account"
    const { container } = shell()
    expect(container.querySelector('[aria-current="page"]')).toBeNull()
  })

  it("counts photos waiting on Review only", () => {
    shell({ reviewCount: 4 })
    for (const el of navs()) {
      const review = within(el).getByRole("link", { name: /^Review/ })
      expect(review.textContent).toContain("4")
      expect(review.textContent).toContain("photos waiting")
      expect(
        within(el).getByRole("link", { name: /^Overview/ }).textContent
      ).toBe("Overview")
    }
  })

  it("says one photo waiting in the singular, and nothing for zero", () => {
    shell({ reviewCount: 1 })
    expect(screen.getAllByText("photo waiting", { exact: false })).toHaveLength(
      3
    )
    cleanup()
    shell({ reviewCount: 0 })
    expect(screen.queryByText(/waiting/)).toBeNull()
  })
})

function Decide() {
  const { settle } = useReviewCount()
  return (
    <button type="button" onClick={() => settle(-1)}>
      decide
    </button>
  )
}

describe("Review badge", () => {
  const badges = () =>
    navs().map(
      (el) =>
        within(el).getByRole("link", { name: /^Review/ }).textContent ?? ""
    )

  it("comes from the provider and decrements on a decision", async () => {
    const user = userEvent.setup()
    render(
      <ManagerShell
        venueName="The Railway"
        userName="Mina Patel"
        reviewCount={2}
      >
        <Decide />
      </ManagerShell>
    )
    expect(badges().every((t) => t.includes("2 photos waiting"))).toBe(true)
    await user.click(screen.getByRole("button", { name: "decide" }))
    expect(badges().every((t) => t.includes("1 photo waiting"))).toBe(true)
    await user.click(screen.getByRole("button", { name: "decide" }))
    expect(badges().every((t) => !t.includes("waiting"))).toBe(true)
    // Never below zero.
    await user.click(screen.getByRole("button", { name: "decide" }))
    expect(badges().every((t) => t === "Review")).toBe(true)
  })

  it("is left out when the count could not be read, and settle does nothing", async () => {
    const user = userEvent.setup()
    render(
      <ManagerShell venueName="The Railway" userName="Mina Patel">
        <Decide />
      </ManagerShell>
    )
    await user.click(screen.getByRole("button", { name: "decide" }))
    expect(badges()).toEqual(["Review", "Review", "Review"])
  })

  it("settle is a no-op without a provider (the admin page)", async () => {
    const user = userEvent.setup()
    render(<Decide />)
    await user.click(screen.getByRole("button", { name: "decide" }))
    expect(screen.getByRole("button", { name: "decide" })).toBeTruthy()
  })
})

describe("managerHrefs", () => {
  it("builds review and menu filters from §5 query parameters", () => {
    expect(managerHrefs.review()).toBe("/manager/review")
    expect(
      managerHrefs.review({
        status: "needs_another_photo",
        section: "starters",
        contributor: "",
        item: "i 1",
      })
    ).toBe(
      "/manager/review?status=needs_another_photo&section=starters&item=i+1"
    )
    expect(managerHrefs.menu({ status: "awaiting_review" })).toBe(
      "/manager/menu?status=awaiting_review"
    )
    expect(managerHrefs.menu({ status: "recheck", q: "  pie " })).toBe(
      "/manager/menu?status=recheck&q=pie"
    )
    expect(managerHrefs.contributor("a/b")).toBe(
      "/manager/review/contributors/a%2Fb"
    )
    expect(managerHrefs.item("x")).toBe("/manager/menu/x")
  })

  it("maps paths to sections", () => {
    expect(managerSectionFor("/manager/")).toBe("overview")
    expect(managerSectionFor("/manager/reviewers")).toBeNull()
    expect(managerSectionFor("/manager/account")).toBeNull()
  })

  // Redesign R4: every route lights the section of the ia.md route map.
  it.each([
    ["/manager", "overview"],
    ["/manager/review", "review"],
    ["/manager/review/album", "review"],
    ["/manager/review/photo/a1", "review"],
    ["/manager/review/contributors/s1", "review"],
    ["/manager/menu", "album"],
    ["/manager/menu/i1", "album"],
    ["/manager/amenities", "album"],
    ["/manager/amenities/places", "album"],
    ["/manager/amenities/c1/capture", "album"],
    ["/manager/album", "album"],
    ["/manager/search", "album"],
    ["/manager/requests", "requests"],
    ["/manager/requests/new", "requests"],
    ["/manager/venue", "venue"],
    ["/manager/venue/facts", "venue"],
    ["/manager/venue/reports", "venue"],
    ["/manager/venue/history", "venue"],
    ["/manager/menu/versions", "venue"],
    ["/manager/menu/specials", "venue"],
    ["/manager/team", "venue"],
    ["/manager/metrics", "venue"],
    ["/manager/exports", "venue"],
    ["/manager/exports/packages/p1", "venue"],
    ["/manager/account", null],
    ["/manager/uploads", null],
  ])("%s lights %s", (path, section) => {
    expect(managerSectionFor(path)).toBe(section)
  })
})
