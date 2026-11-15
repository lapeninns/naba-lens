// @vitest-environment jsdom
// G-7 "needed by" on a dish: the chip's words (never Overdue), dishes with a
// date leading both menu lists in a group of their own, and the manager's set
// and clear control.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))

import { MenuList } from "@/components/nabalens/manager/menu/menu-list"
import {
  NeededByControl,
  type ClearNeededBy,
  type SetNeededBy,
} from "@/components/nabalens/manager/menu/needed-by-control"
import { OurMenuList } from "@/components/nabalens/menu-photos/our-menu-list"
import {
  NEEDED_BY_COPY,
  NeededByChip,
} from "@/components/nabalens/menu-photos/needed-by-chip"
import type { OurMenuItem, OurMenuSection } from "@/lib/server/coverage/types"
import type {
  ManagerMenuItem,
  OverviewSection,
} from "@/lib/server/menu-photos/types"

afterEach(() => {
  cleanup()
  router.refresh.mockClear()
})

const STARTERS = "00000000-0000-4000-8000-0000000000b1"
const MAINS = "00000000-0000-4000-8000-0000000000b2"
const id = (n: number) => `00000000-0000-4000-8000-0000000000c${n}`

describe("NeededByChip", () => {
  it("shows the date until it passes, then Needed; never Overdue", () => {
    const { container, rerender } = render(
      <NeededByChip neededBy={{ date: "2026-11-20", passed: false }} />
    )
    expect(container.textContent).toBe("Needed by 20 Nov 2026")
    rerender(<NeededByChip neededBy={{ date: "2026-11-10", passed: true }} />)
    expect(container.textContent).toBe("Needed")
    const chip = container.querySelector("[data-slot=status-chip]")!
    // The quiet shape, not the Overdue square.
    expect(chip.getAttribute("data-shape")).toBe("plain")
    expect(container.textContent).not.toMatch(/overdue/i)
  })
})

function ourItem(n: number, over: Partial<OurMenuItem> = {}): OurMenuItem {
  return {
    itemId: id(n),
    sectionId: STARTERS,
    sectionName: "Starters",
    sectionKind: "food",
    name: `Dish ${n}`,
    description: null,
    variants: [],
    covered: false,
    acceptedCount: 0,
    needsRecheck: false,
    primary: null,
    itemRevision: 1,
    review: null,
    neededBy: null,
    ...over,
  }
}

const ourSections: OurMenuSection[] = [
  {
    sectionId: STARTERS,
    name: "Starters",
    kind: "food",
    position: 1,
    eligible: 2,
    covered: 0,
    needsRecheck: 0,
    review: null,
  },
  {
    sectionId: MAINS,
    name: "Mains",
    kind: "food",
    position: 2,
    eligible: 2,
    covered: 0,
    needsRecheck: 0,
    review: null,
  },
]

describe("Our menu list", () => {
  it("lists dishes with a date first, in a group of their own", () => {
    render(
      <OurMenuList
        initial={{
          items: [
            ourItem(1, {
              name: "Dal",
              sectionId: MAINS,
              sectionName: "Mains",
              neededBy: { date: "2026-11-10", passed: true },
            }),
            ourItem(2, {
              name: "Soup",
              neededBy: { date: "2026-11-20", passed: false },
            }),
            ourItem(3, { name: "Bread" }),
            ourItem(4, {
              name: "Curry",
              sectionId: MAINS,
              sectionName: "Mains",
            }),
          ],
          nextCursor: null,
        }}
        sections={ourSections}
        canAdd={false}
      />
    )
    const groups = screen.getAllByRole("heading", { level: 2 })
    expect(groups.map((h) => h.textContent)).toEqual([
      NEEDED_BY_COPY.groupTitle,
      "Starters",
      "Mains",
    ])
    const needed = screen.getByRole("list", { name: NEEDED_BY_COPY.groupTitle })
    const rows = within(needed).getAllByRole("article")
    expect(rows.map((r) => within(r).getByRole("heading").textContent)).toEqual(
      ["Dal", "Soup"]
    )
    expect(rows[0]!.textContent).toContain("Needed")
    expect(rows[1]!.textContent).toContain("Needed by 20 Nov 2026")
    // The needed group has no section count; Starters still counts the section.
    expect(needed.closest("section")!.textContent).not.toMatch(/\d+ of \d+/)
    expect(document.body.textContent).not.toMatch(/overdue/i)
  })
})

function managerItem(
  n: number,
  over: Partial<ManagerMenuItem> = {}
): ManagerMenuItem {
  return {
    itemId: id(n),
    name: `Dish ${n}`,
    description: null,
    section: { id: STARTERS, name: "Starters", kind: "food", position: 1 },
    entryPosition: n,
    variants: [],
    status: "needs_photo",
    hasPendingReplacement: false,
    needsRecheck: false,
    ownWaiting: 0,
    othersWaiting: 0,
    acceptedCount: 0,
    candidateCount: 0,
    preferred: null,
    itemRevision: 1,
    neededBy: null,
    ...over,
  }
}

const managerSections: OverviewSection[] = [
  {
    sectionId: STARTERS,
    name: "Starters",
    kind: "food",
    position: 1,
    eligible: 2,
    covered: 0,
    awaitingReview: 0,
    needsPhoto: 2,
  },
  {
    sectionId: MAINS,
    name: "Mains",
    kind: "food",
    position: 2,
    eligible: 1,
    covered: 0,
    awaitingReview: 0,
    needsPhoto: 1,
  },
]

describe("Manager Menu list", () => {
  it("lists dishes with a date first, with their chip, in a group of their own", () => {
    render(
      <MenuList
        initial={{
          items: [
            managerItem(1, {
              name: "Dal",
              section: { id: MAINS, name: "Mains", kind: "food", position: 2 },
              neededBy: { date: "2026-11-20", passed: false },
            }),
            managerItem(2, { name: "Soup" }),
            managerItem(3, { name: "Bread" }),
          ],
          nextCursor: null,
        }}
        sections={managerSections}
        filter={{ status: null, sectionId: null, query: "" }}
        loadItems={vi.fn()}
      />
    )
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    ).toEqual([NEEDED_BY_COPY.groupTitle, "Starters"])
    const needed = screen.getByRole("list", { name: NEEDED_BY_COPY.groupTitle })
    expect(needed.textContent).toContain("Dal")
    expect(needed.textContent).toContain("Needed by 20 Nov 2026")
    expect(document.body.textContent).not.toMatch(/overdue/i)
  })
})

describe("NeededByControl", () => {
  const item = {
    itemId: id(1),
    name: "Dal",
    covered: false,
    neededBy: null,
  }

  it("saves a date for the dish and re-reads the page", async () => {
    const user = userEvent.setup()
    const setAction = vi.fn<SetNeededBy>(async () => ({
      ok: true as const,
      neededBy: { date: "2026-11-20", passed: false },
    }))
    const clearAction = vi.fn<ClearNeededBy>()
    render(
      <NeededByControl
        item={item}
        venueId="00000000-0000-4000-8000-0000000000a1"
        today="2026-11-15"
        maxDate="2027-11-16"
        setAction={setAction}
        clearAction={clearAction}
      />
    )
    const field = screen.getByLabelText("Date")
    expect(field).toHaveProperty("min", "2026-11-15")
    expect(field).toHaveProperty("max", "2027-11-16")
    await user.type(field, "2026-11-20")
    await user.click(screen.getByRole("button", { name: "Save date" }))
    expect(setAction).toHaveBeenCalledWith({
      venueId: "00000000-0000-4000-8000-0000000000a1",
      itemId: id(1),
      neededBy: "2026-11-20",
    })
    expect(await screen.findByText("Dal: Needed by 20 Nov 2026.")).toBeTruthy()
    expect(router.refresh).toHaveBeenCalled()
    // No date yet: nothing to clear.
    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull()
  })

  it("shows the field error the server returns", async () => {
    const user = userEvent.setup()
    render(
      <NeededByControl
        item={item}
        today="2026-11-15"
        maxDate="2027-11-16"
        setAction={async () => ({
          ok: false,
          code: "invalid_input",
          status: 400,
          message: "Check the highlighted fields.",
          fieldErrors: {
            neededBy: "Choose a date from today to a year ahead.",
          },
        })}
        clearAction={vi.fn<ClearNeededBy>()}
      />
    )
    await user.click(screen.getByRole("button", { name: "Save date" }))
    expect(
      await screen.findByText("Choose a date from today to a year ahead.")
    ).toBeTruthy()
    expect(screen.getByLabelText("Date").getAttribute("aria-invalid")).toBe(
      "true"
    )
  })

  it("shows the current date and clears it", async () => {
    const user = userEvent.setup()
    const clearAction = vi.fn<ClearNeededBy>(async () => ({
      ok: true as const,
      cleared: true,
    }))
    render(
      <NeededByControl
        item={{ ...item, neededBy: { date: "2026-11-10", passed: true } }}
        today="2026-11-15"
        maxDate="2027-11-16"
        setAction={vi.fn<SetNeededBy>()}
        clearAction={clearAction}
      />
    )
    expect(screen.getByText("Needed")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Clear date" }))
    expect(clearAction).toHaveBeenCalledWith({ itemId: id(1) })
    expect(await screen.findByText("Cleared the date on Dal.")).toBeTruthy()
    expect(router.refresh).toHaveBeenCalled()
  })

  it("is left out for a dish that has an accepted photo", () => {
    const { container } = render(
      <NeededByControl
        item={{ ...item, covered: true }}
        today="2026-11-15"
        maxDate="2027-11-16"
        setAction={vi.fn<SetNeededBy>()}
        clearAction={vi.fn<ClearNeededBy>()}
      />
    )
    expect(container.textContent).toBe("")
  })
})
