// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  OUR_MENU_COPY,
  OurMenuItemRow,
} from "@/components/nabalens/menu-photos"
import type { OurMenuItem } from "@/lib/server/coverage/types"

afterEach(cleanup)

const DAL: OurMenuItem = {
  itemId: "00000000-0000-4000-8000-0000000000d1",
  sectionId: "00000000-0000-4000-8000-0000000000b1",
  sectionName: "Mains",
  sectionKind: "food",
  name: "Dal makhani",
  description: null,
  variants: [],
  covered: false,
  acceptedCount: 0,
  needsRecheck: false,
  primary: null,
  itemRevision: 1,
  review: null,
}

function row(item: OurMenuItem) {
  render(<OurMenuItemRow item={item} canAdd={false} />)
  return screen.getByRole("article", { name: item.name })
}

describe("Our menu dish row: own photo waiting (UP-25)", () => {
  it("says one own photo is waiting for review", () => {
    expect(
      within(row({ ...DAL, myWaiting: 1 })).getByText(
        "Your photo is waiting for review"
      )
    ).toBeTruthy()
  })

  it("counts several own photos", () => {
    expect(
      within(row({ ...DAL, myWaiting: 3 })).getByText(
        "3 of your photos are waiting for review"
      )
    ).toBeTruthy()
  })

  it("says nothing with none waiting, or before the read has the count", () => {
    for (const item of [{ ...DAL, myWaiting: 0 }, DAL]) {
      const article = row(item)
      expect(within(article).queryByText(/waiting for review/)).toBeNull()
      cleanup()
    }
  })

  it("keeps the venue-wide reviewer count separate", () => {
    const article = row({
      ...DAL,
      myWaiting: 1,
      review: { candidates: 4, oldestCandidateAt: null },
    })
    expect(within(article).getByText("4 photos to review")).toBeTruthy()
    expect(within(article).getByText(OUR_MENU_COPY.myWaiting(1))).toBeTruthy()
  })
})
