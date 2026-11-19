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
  it("lists Today, Album, My photos and Me, and hides Manage by default", () => {
    render(
      <AppShell variant="staff" active="tasks">
        x
      </AppShell>
    )
    expect(links("Staff")).toEqual([
      ["Today", "/staff/home"],
      ["Album", "/staff/album"],
      ["My photos", "/staff/photos"],
      ["Me", "/staff/me"],
    ])
    expect(current("Staff")).toEqual(["Album"])
  })

  it("shows Manage last for a venue manager, with photos to review", () => {
    render(
      <AppShell variant="staff" active="manage" canManage reviewCount={3}>
        x
      </AppShell>
    )
    expect(links("Staff").at(-1)).toEqual(["Manage, 3 to review", "/manager"])
    expect(current("Staff")).toEqual(["Manage, 3 to review"])
  })

  it("leaves Our menu, Photos and People to Me (DESIGN.md §5 Tab bar)", () => {
    render(
      <AppShell variant="staff" active="menu" canManage>
        x
      </AppShell>
    )
    for (const name of ["Our menu", "Photos", "People", "Home"])
      expect(screen.queryByRole("link", { name })).toBeNull()
    expect(current("Staff")).toEqual([])
  })

  it("keeps Me current when no section is given", () => {
    render(<AppShell variant="staff">x</AppShell>)
    expect(current("Staff")).toEqual(["Me"])
    expect(screen.queryByRole("link", { name: "Manage" })).toBeNull()
  })

  it("gives phones five tabs, Add in the middle, never Manage (DESIGN.md §15)", () => {
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
    ).toEqual(["Today", "Album", "Add", "My photos, 2 retakes", "Me"])
    expect(tabbar.queryByRole("link", { name: /Manage/ })).toBeNull()
  })

  it("names Add photos with the hidden queue's unfinished files and opens it", () => {
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
      name: "Add photos, 2 in progress, 1 failed",
    })
    // The shared tab badge, hidden from the name (the name says it all).
    const badge = add.querySelector("[data-slot=add-busy]")!
    expect(badge.getAttribute("aria-hidden")).toBe("true")
    expect(badge.querySelector("[data-slot=count]")?.textContent).toMatch(
      /\b3\b/
    )
    add.click()
    expect(openAdd).toHaveBeenCalledOnce()
  })
})

describe("AppShell admin navigation", () => {
  it("follows spec §8: Overview first, People and Settings last", () => {
    render(
      <AppShell variant="admin" active="venues">
        x
      </AppShell>
    )
    expect(links("Admin")).toEqual([
      ["Overview", "/admin/overview"],
      ["Venues", "/admin/venues"],
      ["Menus", "/admin/menus"],
      ["Library", "/admin"],
      ["Publishing", "/admin/publishing"],
      ["People", "/admin/staff"],
      ["Settings", "/admin/settings"],
    ])
    // Phones and tablets: three sections and More, which lists all seven.
    expect(links("Admin", "tabbar")).toEqual([
      ["Overview", "/admin/overview"],
      ["Venues", "/admin/venues"],
      ["Library", "/admin"],
      ["More", "/admin/more"],
    ])
    expect(current("Admin")).toEqual(["Venues"])
    expect(
      screen.getByRole("link", { name: "Naba-Lens Admin" }).getAttribute("href")
    ).toBe("/admin/overview")
  })

  it("lights up Overview for Coverage and Albums, and More for the rest", () => {
    const { rerender } = render(
      <AppShell variant="admin" active="coverage">
        x
      </AppShell>
    )
    expect(current("Admin")).toEqual(["Overview"])
    expect(current("Admin", "tabbar")).toEqual(["Overview"])
    rerender(
      <AppShell variant="admin" active="settings">
        x
      </AppShell>
    )
    expect(current("Admin")).toEqual(["Settings"])
    expect(current("Admin", "tabbar")).toEqual(["More"])
  })

  // S3-R11: at 1280px an admin's seven sections, the name and Log out were
  // 4px over and the nav shrank with them, squeezing its links. The nav keeps
  // its width; the name (truncated, in a min-w-0 group) gives way. The layout
  // itself is measured in tests/e2e/app-bar-fit.spec.ts.
  it("never shrinks the AppBar sections; the name gives way", () => {
    render(
      <AppShell
        variant="admin"
        active="venues"
        userName="TEST A very long admin name"
      >
        x
      </AppShell>
    )
    const bar = screen
      .getAllByRole("navigation", { name: "Admin" })
      .find((el) => el.dataset.slot === "app-nav")!
    expect(bar.className).toMatch(/\bshrink-0\b/)
    expect(bar.className).not.toMatch(/\bmin-w-0\b/)
    const name = screen.getByText("TEST A very long admin name")
    expect(name.className).toMatch(/\btruncate\b/)
    expect(name.parentElement!.className).toMatch(/\bmin-w-0\b/)
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
