// @vitest-environment jsdom
// S3-R5 (S3-E2E-2 D2, D3): narrow-phone layout guards. The browser proof is
// tests/e2e/full-app/ac15-19-review.spec.ts "AC15-AC19 layout" at 320 px;
// these keep the two rules that make it pass from being dropped.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/manager",
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { ManagerNav } from "@/components/nabalens/manager/manager-nav"
import { Button } from "@/components/ui/button"

afterEach(cleanup)

describe("manager phone tab bar (D3)", () => {
  it("scales each label to fit a fifth of the bar, with no side padding", () => {
    render(<ManagerNav kind="bar" />)
    const links = screen
      .getByRole("navigation", { name: "Venue workspace" })
      .querySelectorAll("a")
    expect(links).toHaveLength(5)
    for (const link of links) {
      expect(link.className).toContain(
        "[font-size:min(1.0625rem,calc((100vw_-_0.5rem)/24))]!"
      )
      expect(link.className).toContain("px-0")
      expect(link.className).not.toContain("px-0.5")
    }
  })
})

describe("Button (D2)", () => {
  it("never grows past its container, so a long label wraps", () => {
    render(<Button>People or personal details in shot</Button>)
    expect(screen.getByRole("button").className).toMatch(/\bmax-w-full\b/)
  })
})
