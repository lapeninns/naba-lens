// @vitest-environment jsdom
// The workspace's not-found is the whole page, so its title is the page's
// heading (as on the admin and staff not-found pages).
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import ManagerNotFound from "@/app/manager/not-found"

afterEach(cleanup)

describe("manager not-found", () => {
  it("names the page with a heading and offers the way back", () => {
    render(<ManagerNotFound />)
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This page isn't available in your workspace",
      })
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Go to Overview" }).getAttribute("href")
    ).toBe("/manager")
  })
})
