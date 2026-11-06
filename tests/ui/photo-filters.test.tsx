// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}))

import { PhotoFilters } from "@/app/staff/community/photo-filters"
import type { PhotoFilters as Filters } from "@/app/staff/community/search"

const VENUES = [
  { id: "0b9c4d6e-1f2a-4b3c-8d9e-0f1a2b3c4d5e", name: "The Railway" },
  { id: "1c9c4d6e-1f2a-4b3c-8d9e-0f1a2b3c4d5e", name: "The Bell" },
]
const none: Filters = { venueId: null, mediaType: null, department: null }

afterEach(() => {
  cleanup()
  push.mockReset()
})

async function openSheet(filters: Filters = none, activeCount = 0) {
  const user = userEvent.setup()
  render(
    <PhotoFilters venues={VENUES} filters={filters} activeCount={activeCount} />
  )
  await user.click(screen.getByRole("button", { name: /^Filters/ }))
  return { user, sheet: await screen.findByRole("dialog", { name: "Filters" }) }
}

describe("PhotoFilters", () => {
  it("shows the number of filters on in the trigger", () => {
    const { rerender } = render(
      <PhotoFilters venues={VENUES} filters={none} activeCount={0} />
    )
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy()
    rerender(
      <PhotoFilters
        venues={VENUES}
        filters={{
          venueId: VENUES[0].id,
          mediaType: "image",
          department: "boh",
        }}
        activeCount={3}
      />
    )
    const trigger = screen.getByRole("button", {
      name: /^Filters\s*,\s*3\s*active$/,
    })
    expect(trigger.querySelector("[data-slot=count]")?.textContent).toContain(
      "3"
    )
  })

  it("opens the sheet with venue, team and media fields", async () => {
    const { sheet } = await openSheet()
    expect(within(sheet).getByRole("heading", { name: "Filters" })).toBeTruthy()
    const venue = within(sheet).getByRole("combobox", { name: "Venue" })
    expect(venue.textContent).toContain("All venues")
    expect(venue.getAttribute("aria-describedby")).toBe("photos-venue-hint")
    expect(within(sheet).getByText("Where the photo was taken.")).toBeTruthy()
    expect(
      within(sheet).getByRole("combobox", { name: "Team" }).textContent
    ).toContain("All teams")
    const media = within(sheet).getByRole("radiogroup", { name: "Media" })
    expect(
      within(media)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent)
    ).toEqual(["Photos", "Videos", "Photos and videos"])
    expect(
      within(media).getByRole<HTMLInputElement>("radio", {
        name: "Photos and videos",
      }).checked
    ).toBe(true)
    const footer = sheet.querySelector("[data-slot=dialog-footer]")!
    expect([...footer.children].map((el) => el.textContent)).toEqual([
      "Clear filters",
      "Apply filters",
    ])
    expect(
      within(sheet)
        .getByRole("link", { name: "Clear filters" })
        .getAttribute("href")
    ).toBe("/staff/community")
  })

  it("lists the teams and venues to choose from", async () => {
    const { user, sheet } = await openSheet()
    await user.click(within(sheet).getByRole("combobox", { name: "Team" }))
    expect(
      (await screen.findAllByRole("option")).map((o) => o.textContent)
    ).toEqual(["All teams", "Front of house", "Back of house"])
    await user.keyboard("{Escape}")
    await user.click(within(sheet).getByRole("combobox", { name: "Venue" }))
    expect(
      (await screen.findAllByRole("option")).map((o) => o.textContent)
    ).toEqual(["All venues", "The Railway", "The Bell"])
  })

  it("applies only the filters that are on", async () => {
    const { user, sheet } = await openSheet()
    await user.click(within(sheet).getByRole("combobox", { name: "Team" }))
    await user.click(
      await screen.findByRole("option", { name: "Back of house" })
    )
    await user.click(within(sheet).getByRole("radio", { name: "Videos" }))
    await user.click(
      within(sheet).getByRole("button", { name: "Apply filters" })
    )
    expect(push).toHaveBeenCalledWith(
      "/staff/community?department=boh&type=video"
    )
  })

  it("keeps the current filters when reopened", async () => {
    const { user, sheet } = await openSheet(
      { venueId: VENUES[1].id, mediaType: "image", department: null },
      2
    )
    expect(
      within(sheet).getByRole("combobox", { name: "Venue" }).textContent
    ).toContain("The Bell")
    expect(
      within(sheet).getByRole<HTMLInputElement>("radio", { name: "Photos" })
        .checked
    ).toBe(true)
    await user.click(
      within(sheet).getByRole("radio", { name: "Photos and videos" })
    )
    await user.click(
      within(sheet).getByRole("button", { name: "Apply filters" })
    )
    expect(push).toHaveBeenCalledWith(`/staff/community?venue=${VENUES[1].id}`)
  })
})
