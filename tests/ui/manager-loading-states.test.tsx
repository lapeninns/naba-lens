// @vitest-environment jsdom
// The workspace's loading states: each page announces what it is loading,
// rather than every page saying "Loading menu photos".
import { cleanup, render, screen, within } from "@testing-library/react"
import type { ComponentType } from "react"
import { afterEach, describe, expect, it } from "vitest"

import ManagerAccountLoading from "@/app/manager/account/loading"
import ManagerLoading from "@/app/manager/loading"
import ManagerMenuItemLoading from "@/app/manager/menu/[itemId]/loading"
import ManagerMenuLoading from "@/app/manager/menu/loading"
import ManagerContributorLoading from "@/app/manager/review/contributors/[staffId]/loading"
import ManagerReviewLoading from "@/app/manager/review/loading"

afterEach(cleanup)

const CASES: [string, ComponentType, string][] = [
  ["Overview", ManagerLoading, "Loading the overview"],
  ["Review", ManagerReviewLoading, "Loading photos for review"],
  [
    "Contributor",
    ManagerContributorLoading,
    "Loading this contributor's photos",
  ],
  ["Menu", ManagerMenuLoading, "Loading the menu"],
  ["Menu item", ManagerMenuItemLoading, "Loading this menu item"],
  ["Account", ManagerAccountLoading, "Loading your account"],
]

describe("manager loading states", () => {
  it.each(CASES)("%s announces its own content", (_, Loading, label) => {
    const { container } = render(<Loading />)
    expect(screen.getByRole("status").textContent).toBe(label)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(container.textContent).not.toContain("menu photos")
  })

  // The handoff's Loading state: the real title and tabs are already there,
  // with sunken blocks in the shape of the chips and rows that are coming.
  it("Album › Menu shows its real title and tabs while the chips and rows load", () => {
    const { container } = render(<ManagerMenuLoading />)
    expect(
      screen.getByRole("heading", { level: 1, name: "Album" })
    ).toBeTruthy()
    const tabs = screen.getByRole("navigation", { name: "Album views" })
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((l) => l.textContent)
    ).toEqual(["Menu", "Spaces", "Amenities"])
    expect(container.querySelectorAll('[data-shape="button"]').length).toBe(5)
  })
})
