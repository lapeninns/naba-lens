// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/components/nabalens"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { AddProvider } from "@/components/nabalens/shell/add-context"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  refresh.mockClear()
})

// The AppBar nav (md up) and the TabBar (phones) share a name; CSS shows one.
function nav(name: string, slot: "app-nav" | "tabbar") {
  const found = screen
    .getAllByRole("navigation", { name })
    .find((el) => el.dataset.slot === slot)
  if (!found) throw new Error(`no ${slot} named ${name}`)
  return within(found)
}

function links(name: string, slot: "app-nav" | "tabbar" = "app-nav") {
  return nav(name, slot)
    .getAllByRole("link")
    .map((a) => [a.textContent, a.getAttribute("href")])
}

function current(name: string, slot: "app-nav" | "tabbar" = "app-nav") {
  return nav(name, slot)
    .getAllByRole("link")
    .filter((a) => a.getAttribute("aria-current") === "page")
    .map((a) => a.textContent)
}

describe("AppShell staff navigation", () => {
  it("puts Home first and hides Manage by default", () => {
    render(
      <AppShell variant="staff" active="tasks">
        x
      </AppShell>
    )
    expect(links("Staff")).toEqual([
      ["Home", "/staff/tasks"],
      ["Our menu", "/staff/menu"],
      ["Photos", "/staff/community"],
      ["People", "/staff/people"],
      ["Me", "/staff"],
    ])
    expect(current("Staff")).toEqual(["Home"])
  })

  it("shows Manage last for a venue manager, with photos to review", () => {
    render(
      <AppShell variant="staff" active="manage" canManage reviewCount={3}>
        x
      </AppShell>
    )
    expect(links("Staff").at(-1)).toEqual([
      "Manage, 3 to review",
      "/staff/manage",
    ])
    expect(current("Staff")).toEqual(["Manage, 3 to review"])
  })

  it("marks Our menu current; a manager's copy steps aside from md to xl", () => {
    render(
      <AppShell variant="staff" active="menu" canManage>
        x
      </AppShell>
    )
    expect(current("Staff")).toEqual(["Our menu"])
    const link = nav("Staff", "app-nav").getByRole("link", { name: "Our menu" })
    // Six sections beside Add and Log out don't fit below 1280px; Home's
    // card and Manage link to it.
    expect(link.className).toContain("md:max-xl:hidden")
    // The phone TabBar never gains a sixth tab for it.
    expect(
      nav("Staff", "tabbar").queryByRole("link", { name: "Our menu" })
    ).toBeNull()
  })

  it("steps Our menu aside from md to lg only for other staff", () => {
    render(
      <AppShell variant="staff" active="menu">
        x
      </AppShell>
    )
    const link = nav("Staff", "app-nav").getByRole("link", { name: "Our menu" })
    // Five sections beside Add and Log out don't fit below 1024px.
    expect(link.className).toContain("md:max-lg:hidden")
    expect(link.className).not.toContain("md:max-xl:hidden")
  })

  it("keeps Me current when no section is given", () => {
    render(<AppShell variant="staff">x</AppShell>)
    expect(current("Staff")).toEqual(["Me"])
    expect(screen.queryByRole("link", { name: "Manage" })).toBeNull()
  })

  it("gives phones five tabs with Add raised in the middle, never a sixth", () => {
    render(
      <AppShell variant="staff" active="community" canManage todoCount={2}>
        x
      </AppShell>
    )
    const tabbar = nav("Staff", "tabbar")
    expect(
      Array.from(
        screen
          .getAllByRole("navigation", { name: "Staff" })
          .find((el) => el.dataset.slot === "tabbar")!.children
      ).map((el) => el.textContent)
    ).toEqual(["Home, 2 things to do", "Photos", "Add", "People", "Me"])
    expect(current("Staff", "tabbar")).toEqual(["Photos"])
    expect(tabbar.queryByRole("link", { name: /Manage/ })).toBeNull()
  })

  it("names Add with the hidden queue's unfinished files and opens it", () => {
    const openAdd = vi.fn()
    render(
      <AddProvider
        value={{
          openAdd,
          busy: { count: 3, words: "2 in progress, 1 failed" },
        }}
      >
        <AppShell variant="staff" active="community">
          x
        </AppShell>
      </AddProvider>
    )
    const add = nav("Staff", "tabbar").getByRole("button", {
      name: "Add, 2 in progress, 1 failed",
    })
    expect(add.querySelector("[data-slot=add-busy]")?.textContent).toBe("3")
    expect(
      screen.getByRole("button", {
        name: "Add photos, 2 in progress, 1 failed",
      })
    ).toBeTruthy()
    add.click()
    expect(openAdd).toHaveBeenCalledOnce()
  })
})

describe("AppShell admin navigation", () => {
  it("lists Coverage after Menus and tags the role", () => {
    render(
      <AppShell variant="admin" active="coverage">
        x
      </AppShell>
    )
    expect(links("Admin")).toEqual([
      ["Content", "/admin"],
      ["Staff", "/admin/staff"],
      ["Menus", "/admin/menus"],
      ["Coverage", "/admin/coverage"],
    ])
    expect(links("Admin", "tabbar")).toEqual(links("Admin"))
    expect(current("Admin")).toEqual(["Coverage"])
    expect(screen.getByRole("link", { name: "Naba-Lens Admin" })).toBeTruthy()
  })
})

describe("AppShell offline notice", () => {
  function goOffline() {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event("offline"))
    })
  }

  function goOnline() {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event("online"))
    })
  }

  const offlineAlerts = () =>
    screen
      .queryAllByRole("alert")
      .filter((el) => el.textContent?.includes("You're offline"))

  it("shows the copy-deck notice with the time once the browser goes offline", () => {
    render(
      <AppShell variant="admin" active="content">
        <h1>Content</h1>
      </AppShell>
    )
    expect(offlineAlerts()).toHaveLength(0)

    goOffline()
    const [alert] = offlineAlerts()
    expect(alert).toBeTruthy()
    expect(within(alert).getByText("You're offline")).toBeTruthy()
    // Rendered in the browser, the shell has no server render time: it
    // never claims one (X-01), and says only when the connection dropped.
    expect(alert.textContent).toMatch(/You've been offline since \d{2}:\d{2}\./)
    expect(alert.textContent).not.toMatch(/Loaded at|last updated/)
    // Above the page content, inside main.
    const main = screen.getByRole("main")
    expect(main.contains(alert)).toBe(true)
    expect(
      alert.compareDocumentPosition(screen.getByRole("heading")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    within(alert).getByRole("button", { name: "Try again" }).click()
    expect(refresh).toHaveBeenCalledTimes(1)

    goOnline()
    expect(offlineAlerts()).toHaveLength(0)
  })

  it("leaves the notice to a page that places its own", () => {
    render(
      <AppShell variant="staff" active="people">
        <h1>People</h1>
        <div data-testid="page-slot">
          <OfflineNotice />
        </div>
      </AppShell>
    )
    goOffline()
    const alerts = offlineAlerts()
    expect(alerts).toHaveLength(1)
    expect(screen.getByTestId("page-slot").contains(alerts[0])).toBe(true)
  })

  it("comes back when the page's own notice unmounts", () => {
    const { rerender } = render(
      <AppShell variant="admin" active="staff">
        <OfflineNotice />
      </AppShell>
    )
    goOffline()
    expect(offlineAlerts()).toHaveLength(1)
    rerender(
      <AppShell variant="admin" active="staff">
        <p>No notice here</p>
      </AppShell>
    )
    expect(offlineAlerts()).toHaveLength(1)
  })
})

describe("AppShell Log out", () => {
  it("marks the logout form for the leave guard", () => {
    const { container } = render(
      <AppShell variant="admin" active="content">
        x
      </AppShell>
    )
    const form = container.querySelector("form[data-logout]")
    expect(form).not.toBeNull()
    expect(
      within(form as HTMLElement).getByRole("button", { name: "Log out" })
    ).toBeTruthy()
  })
})
