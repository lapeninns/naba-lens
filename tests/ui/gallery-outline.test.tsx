// @vitest-environment jsdom
// The gallery page's heading outline (review A11Y-3): specimens of PageHeader
// and NotFoundCard render a real page title, which must not add a second h1
// or skip a level inside the gallery's own h1 > h2 > h3 outline.
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound")
  },
  usePathname: () => "/ui-preview/gallery",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import GalleryPage from "@/app/(dev)/ui-preview/gallery/page"
import { NotFoundCard } from "@/components/nabalens/not-found-card"
import { PageHeader } from "@/components/nabalens/page-header"

afterEach(cleanup)

describe("gallery heading outline", () => {
  it("has one h1 and never skips a level going down", () => {
    const { container } = render(<GalleryPage />)
    const headings = [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(
      (node) => ({
        level: Number(node.tagName[1]),
        text: (node.textContent ?? "").trim(),
      })
    )
    expect(headings.length).toBeGreaterThan(50)
    expect(headings.filter((h) => h.level === 1).map((h) => h.text)).toEqual([
      "Design system gallery",
    ])
    const skips = headings
      .map((heading, index) => ({ heading, before: headings[index - 1] }))
      .filter(
        ({ heading, before }) => before && heading.level > before.level + 1
      )
      .map(
        ({ heading, before }) =>
          `h${before.level} "${before.text}" -> h${heading.level} "${heading.text}"`
      )
    expect(skips).toEqual([])
  })
})

// Review R8: combinations the props allow must each have a specimen.
describe("gallery specimens", () => {
  const has = (container: HTMLElement, selector: string) =>
    container.querySelector(selector) !== null

  it("shows every Button and LinkButton variant at every size it can take", () => {
    const { container } = render(<GalleryPage />)
    const missing: string[] = []
    const variants = [
      "primary",
      "secondary",
      "quiet",
      "danger",
      "danger-quiet",
      "link",
    ]
    for (const variant of variants) {
      const sizes =
        variant === "link"
          ? ["sm", "md", "lg"]
          : ["sm", "md", "lg", "icon", "icon-lg"]
      for (const size of sizes) {
        const pair = `[data-variant="${variant}"][data-size="${size}"]`
        if (!has(container, `[data-slot="button"]${pair}`)) {
          missing.push(`Button ${variant} ${size}`)
        }
      }
      // A link has no icon square, on Button or on LinkButton.
      for (const size of ["icon", "icon-lg"]) {
        if (variant !== "link") continue
        expect(
          has(container, `[data-variant="link"][data-size="${size}"]`)
        ).toBe(false)
      }
      for (const size of ["sm", "md", "lg"]) {
        const pair = `[data-variant="${variant}"][data-size="${size}"]`
        if (!has(container, `[data-slot="link-button"]${pair}`)) {
          missing.push(`LinkButton ${variant} ${size}`)
        }
      }
    }
    for (const selector of [
      '[data-slot="button"][data-size="icon-lg"][data-loading]',
      '[data-slot="link-button"][data-size="icon"]',
      '[data-slot="link-button"][data-size="icon-lg"]',
    ]) {
      if (!has(container, selector)) missing.push(selector)
    }
    expect(missing).toEqual([])
  })

  it("shows the field, choice and display sizes and states the props allow", () => {
    const { container } = render(<GalleryPage />)
    const wanted = [
      '[data-slot="input"][data-size="lg"]',
      '[data-slot="select-trigger"][data-size="lg"]',
      '[data-slot="select-trigger"][aria-invalid="true"]',
      '[data-slot="search-field"][data-size="lg"]',
      '[data-slot="search-field"] [data-slot="input"][aria-invalid="true"]',
      '[data-slot="search-field"] [data-slot="input"][aria-disabled="true"]',
      '[data-slot="option-row"][data-type="checkbox"][data-size="sm"]',
      '[data-slot="option-row"][data-type="checkbox"][data-size="lg"]',
      '[data-slot="progress"][data-mode="bar"][data-size="sm"]',
      '[data-slot="progress"][data-mode="bar"][data-tone="neutral"]',
      '[data-slot="progress"][data-mode="bar"][data-tone="ok"]',
      '[data-slot="toggle"][data-size="sm"]',
      '[data-slot="toggle"][data-size="lg"]',
      '[data-slot="field-set"] [data-slot="field-legend"][data-variant="legend"]',
      '[data-slot="field-legend"][data-variant="label"]',
      '[data-slot="field-separator"]',
      '[data-slot="field-content"]',
      '[data-slot="combobox"][data-invalid]',
      '[data-slot="skeleton-region"]',
      '[data-slot="button"][aria-pressed="true"] [data-slot="button-pressed-mark"]',
    ]
    expect(wanted.filter((selector) => !has(container, selector))).toEqual([])
  })

  it("draws a pressed Button as pressed, and marks a disabled Switch", () => {
    const { container } = render(<GalleryPage />)
    const pressed = [
      ...container.querySelectorAll(
        '[data-slot="button"][aria-pressed="true"]'
      ),
    ]
    expect(pressed.length).toBeGreaterThan(0)
    for (const button of pressed) {
      expect(button.className).toContain("aria-pressed:edge-selected")
    }
    const off = [
      ...container.querySelectorAll('[data-slot="switch"][data-disabled]'),
    ]
    expect(off.length).toBeGreaterThan(0)
    for (const control of off) {
      expect(control.getAttribute("aria-disabled")).toBe("true")
    }
  })
})

describe("page titles", () => {
  it("PageHeader and NotFoundCard are the page's h1 unless told otherwise", () => {
    const { container, rerender } = render(
      <>
        <PageHeader title="People" />
      </>
    )
    expect(container.querySelector("h1")?.textContent).toBe("People")
    rerender(<NotFoundCard backHref="/" backLabel="Go to Home" />)
    expect(container.querySelector("h1")?.id).toBe("not-found-title")
    rerender(
      <>
        <PageHeader title="People" titleAs="h4" />
        <NotFoundCard titleAs="h3" backHref="/" backLabel="Go to Home" />
      </>
    )
    expect(container.querySelector("h1")).toBeNull()
    expect(container.querySelector("h4")?.textContent).toBe("People")
    expect(container.querySelector("h3")?.id).toBe("not-found-title")
  })
})
