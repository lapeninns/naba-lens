// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
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

// The tabs row (md up) and the tab bar (phones) share a name; CSS shows one.
function navs() {
  return screen.getAllByRole("navigation", { name: "Venue workspace" })
}

function links(el: HTMLElement) {
  return within(el)
    .getAllByRole("link")
    .map((a) => [a.textContent?.replace(/,.*$/, ""), a.getAttribute("href")])
}

describe("ManagerShell", () => {
  it("shows Overview, Review and Menu at desktop and phone widths", () => {
    shell()
    const found = navs()
    expect(found.map((n) => n.dataset.slot).sort()).toEqual([
      "section-tabs",
      "tabbar",
    ])
    for (const el of found) {
      expect(links(el)).toEqual([
        ["Overview", "/manager"],
        ["Review", "/manager/review"],
        ["Menu", "/manager/menu"],
      ])
    }
  })

  it("names the venue and links the wordmark to /manager and Account", () => {
    shell()
    expect(screen.getByText("The Railway")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Naba-Lens" }).getAttribute("href")
    ).toBe("/manager")
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
    ["/manager/menu", "Menu"],
    ["/manager/menu/abc", "Menu"],
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
      2
    )
    cleanup()
    shell({ reviewCount: 0 })
    expect(screen.queryByText(/waiting/)).toBeNull()
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
})
