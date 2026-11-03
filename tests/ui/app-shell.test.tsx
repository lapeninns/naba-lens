// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { AppShell } from "@/components/nabalens"

afterEach(cleanup)

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
