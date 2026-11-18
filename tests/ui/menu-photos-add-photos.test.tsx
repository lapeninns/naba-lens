// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  OUR_MENU_COPY,
  OurMenuItemRow,
} from "@/components/nabalens/menu-photos"
import {
  AddProvider,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import type { OurMenuItem } from "@/lib/server/coverage/types"

afterEach(cleanup)

const MOMO: OurMenuItem = {
  itemId: "00000000-0000-4000-8000-0000000000c9",
  sectionId: "00000000-0000-4000-8000-0000000000b1",
  sectionName: "Starters",
  sectionKind: "food",
  name: "Momo",
  description: null,
  variants: [
    { variantId: "00000000-0000-4000-8000-0000000000e1", name: "Veg" },
    { variantId: "00000000-0000-4000-8000-0000000000e2", name: "Chicken" },
  ],
  covered: false,
  acceptedCount: 0,
  needsRecheck: false,
  primary: null,
  itemRevision: 1,
  review: null,
}

const PRESET = {
  itemId: MOMO.itemId,
  variantId: null,
  itemName: "Momo",
  variantName: null,
}

function renderRow(
  openAdd: (opts?: OpenAddOptions) => void,
  props: Partial<React.ComponentProps<typeof OurMenuItemRow>> = {}
) {
  return render(
    <AddProvider value={{ openAdd }}>
      <OurMenuItemRow item={MOMO} canAdd {...props} />
    </AddProvider>
  )
}

// Gallery first (DESIGN.md §2, §9; AL-6): the dish row's one way to add a
// photo opens the phone's photos with the dish applied. It used to offer the
// in-app camera ("Take a photo of this dish") first.
describe("Our menu dish row: Add photos of this dish", () => {
  it("offers the phone's photos only, naming the dish", () => {
    renderRow(vi.fn())
    const row = screen.getByRole("article", { name: "Momo" })
    const buttons = within(row).getAllByRole("button")
    expect(buttons.map((b) => b.textContent)).toEqual([OUR_MENU_COPY.addPhotos])
    expect(OUR_MENU_COPY.addPhotos).toBe("Add photos of this dish")
    const describedBy = buttons[0].getAttribute("aria-describedby")
    expect(document.getElementById(describedBy!)?.textContent).toBe("Momo")
    // No camera wording is left.
    expect(within(row).queryByText(/Take a photo|camera/i)).toBeNull()
    expect(within(row).queryByText("Choose from photos")).toBeNull()
  })

  it("opens the photo library for photos only, with the dish applied (no variant picked)", async () => {
    const user = userEvent.setup()
    const openAdd = vi.fn()
    renderRow(openAdd)
    await user.click(
      screen.getByRole("button", { name: "Add photos of this dish" })
    )
    // One app tap opens the phone's photos with the dish as the label; Add
    // applies it as a removable chip and starts sending.
    expect(openAdd).toHaveBeenCalledTimes(1)
    expect(openAdd).toHaveBeenCalledWith({
      source: "library",
      imagesOnly: true,
      preset: PRESET,
    })
  })

  it("keeps the review link as the row's one blue action for reviewers", () => {
    renderRow(vi.fn(), {
      item: {
        ...MOMO,
        review: { candidates: 2, oldestCandidateAt: null },
      },
      reviewHref: "/staff/manage/menu/items?item=momo",
    })
    const row = screen.getByRole("article", { name: "Momo" })
    expect(
      within(row).getByRole("link", { name: "All photos of this dish" })
    ).toBeTruthy()
    // Every dish row offering a blue button would break one blue per screen.
    const add = within(row).getByRole("button", {
      name: "Add photos of this dish",
    })
    expect(add.getAttribute("data-variant")).not.toBe("primary")
  })

  it("offers nothing to people who cannot add photos", () => {
    renderRow(vi.fn(), { canAdd: false })
    expect(screen.queryByRole("button")).toBeNull()
  })
})
