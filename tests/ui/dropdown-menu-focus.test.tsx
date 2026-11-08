// @vitest-environment jsdom
// Every menu item draws the project's focus outline for keyboard focus: the
// focus tint alone (surface-2 on the menu) is about 1.2:1, below WCAG 1.4.11.
// The outline is inset because the popup scrolls and would clip it.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

afterEach(cleanup)

const FOCUS = [
  "focus-visible:outline-3",
  "focus-visible:-outline-offset-3",
  "focus-visible:outline-focus",
  "focus-visible:outline-solid",
]

describe("DropdownMenu items", () => {
  it("each kind of item draws the focus outline", async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>More</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Deactivate</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>
            Show photos
          </DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">Newest</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    const items = [
      ...(await screen.findAllByRole("menuitem")),
      ...screen.getAllByRole("menuitemcheckbox"),
      ...screen.getAllByRole("menuitemradio"),
    ]
    expect(items.map((item) => item.textContent)).toEqual([
      "Edit",
      "Deactivate",
      "Move to",
      "Show photos",
      "Newest",
    ])
    for (const item of items)
      for (const cls of FOCUS)
        expect(item.className, item.textContent!).toContain(cls)
  })
})
