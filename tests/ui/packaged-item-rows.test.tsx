// @vitest-environment jsdom
// S5-R1 (FA-51; review finding Y2): an optional packaged item (packaged
// without Photo wanted) is never shown as a gap. Staff Our menu and the
// manager Menu say Album's word Optional instead of "Still needs a photo".
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { MenuStatusChip } from "@/components/nabalens/manager/menu/menu-item-row"
import {
  OUR_MENU_COPY,
  OurMenuItemRow,
} from "@/components/nabalens/menu-photos"
import { OPTIONAL_SLOT_WORD } from "@/lib/album/model"
import type { OurMenuItem } from "@/lib/server/coverage/types"

afterEach(cleanup)

const LAGER: OurMenuItem = {
  itemId: "00000000-0000-4000-8000-0000000000d2",
  sectionId: "00000000-0000-4000-8000-0000000000b2",
  sectionName: "Drinks",
  sectionKind: "drinks",
  name: "Bottled lager",
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

describe("Our menu: an optional packaged item", () => {
  it("reads Optional, never Still needs a photo", () => {
    const article = row({ ...LAGER, optional: true })
    expect(within(article).getByText(OPTIONAL_SLOT_WORD)).toBeTruthy()
    expect(within(article).queryByText(OUR_MENU_COPY.gaps)).toBeNull()
  })

  it("keeps Has an accepted photo once a photo is accepted", () => {
    const article = row({ ...LAGER, optional: true, covered: true })
    expect(within(article).getByText(OUR_MENU_COPY.hasPhoto)).toBeTruthy()
    expect(within(article).queryByText(OPTIONAL_SLOT_WORD)).toBeNull()
  })

  it("leaves a counted item a gap", () => {
    const article = row({ ...LAGER, optional: false })
    expect(within(article).getByText(OUR_MENU_COPY.gaps)).toBeTruthy()
  })
})

describe("manager Menu: the optional headline", () => {
  it("reads Optional", () => {
    render(<MenuStatusChip status="optional" />)
    expect(screen.getByText(OPTIONAL_SLOT_WORD)).toBeTruthy()
    expect(screen.queryByText(MANAGER_COPY.menu.status.needs_photo)).toBeNull()
  })
})
