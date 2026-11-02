// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { AppShell } from "@/components/nabalens"

afterEach(cleanup)

function links(nav: string) {
  return within(screen.getByRole("navigation", { name: nav }))
    .getAllByRole("link")
    .map((a) => [a.textContent, a.getAttribute("href")])
}

function current(nav: string) {
  return within(screen.getByRole("navigation", { name: nav }))
    .getAllByRole("link")
    .filter((a) => a.getAttribute("aria-current") === "page")
    .map((a) => a.textContent)
}

describe("AppShell staff navigation", () => {
  it("puts My tasks first and hides Manage by default", () => {
    render(
      <AppShell variant="staff" active="tasks">
        x
      </AppShell>
    )
    expect(links("Staff")).toEqual([
      ["My tasks", "/staff/tasks"],
      ["Explore", "/staff/community"],
      ["People", "/staff/people"],
      ["My portfolio", "/staff"],
    ])
    expect(current("Staff")).toEqual(["My tasks"])
  })

  it("shows Manage last for a venue manager", () => {
    render(
      <AppShell variant="staff" active="manage" canManage>
        x
      </AppShell>
    )
    expect(links("Staff").at(-1)).toEqual(["Manage", "/staff/manage"])
    expect(current("Staff")).toEqual(["Manage"])
  })

  it("keeps My portfolio current when no section is given", () => {
    render(<AppShell variant="staff">x</AppShell>)
    expect(current("Staff")).toEqual(["My portfolio"])
    expect(screen.queryByRole("link", { name: "Manage" })).toBeNull()
  })
})

describe("AppShell admin navigation", () => {
  it("lists Coverage after Menus", () => {
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
    expect(current("Admin")).toEqual(["Coverage"])
  })
})
