// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import {
  DishGuide,
  GUIDE_PATH,
  guideLede,
  TaskPhotoGuide,
} from "@/components/nabalens/guide"
import { suggestedAngles } from "@/lib/guide/dish-guide"

afterEach(cleanup)

const tile = (name: RegExp) => screen.getByRole("button", { name })

describe("DishGuide", () => {
  it("renders four angle buttons, marking the suggested ones", () => {
    render(<DishGuide suggested={suggestedAngles(2)} />)
    const list = screen.getByRole("list")
    const buttons = within(list).getAllByRole("button")
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "45° angle, suggested. Open example",
      "Overhead, suggested. Open example",
      "Close-up. Open example",
      "Side view. Open example",
    ])
    expect(within(list).getAllByText("Suggested")).toHaveLength(2)
    expect(
      within(list)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent)
    ).toEqual(["45° angle", "Overhead", "Close-up", "Side view"])
  })

  it("marks no angle on the guide page", () => {
    render(<DishGuide suggested={[]} headingLevel={4} />)
    expect(screen.queryByText("Suggested")).toBeNull()
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(4)
  })

  it("dish buttons switch every image and set aria-pressed", async () => {
    const user = userEvent.setup()
    render(<DishGuide suggested={[]} />)
    const group = screen.getByRole("group", { name: "Example dish" })
    const grill = within(group).getByRole("button", { name: "Mixed grill" })
    const momos = within(group).getByRole("button", { name: "Momos" })
    expect(grill.getAttribute("aria-pressed")).toBe("true")
    expect(momos.getAttribute("aria-pressed")).toBe("false")
    const sources = () =>
      Array.from(screen.getByRole("list").querySelectorAll("img")).map((img) =>
        img.getAttribute("src")
      )
    expect(sources()).toEqual([
      "/guide/v1/mixed-grill-45.webp",
      "/guide/v1/mixed-grill-overhead.webp",
      "/guide/v1/mixed-grill-close-up.webp",
      "/guide/v1/mixed-grill-side.webp",
    ])

    await user.click(momos)
    expect(momos.getAttribute("aria-pressed")).toBe("true")
    expect(grill.getAttribute("aria-pressed")).toBe("false")
    expect(sources()).toEqual([
      "/guide/v1/momos-45.webp",
      "/guide/v1/momos-overhead.webp",
      "/guide/v1/momos-close-up.webp",
      "/guide/v1/momos-side.webp",
    ])
    // Momos keep their native 716 px for the viewer size.
    expect(
      screen.getByRole("list").querySelector("img")?.getAttribute("srcset")
    ).toBe("/guide/v1/momos-45.webp 480w, /guide/v1/momos-45@2x.webp 716w")
  })

  it("opens the viewer, steps through the angles and returns focus", async () => {
    const user = userEvent.setup()
    render(<DishGuide suggested={[]} />)
    const opener = tile(/^45° angle/)
    await user.click(opener)

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("1 of 4 · Mixed grill")).toBeTruthy()
    expect(
      within(dialog).getByRole("heading", { name: "45° angle" })
    ).toBeTruthy()
    expect(
      within(dialog).getByRole("img", {
        name: "Mixed grill, 45° angle example",
      })
    ).toBeTruthy()
    const previous = within(dialog).getByRole("button", { name: "Previous" })
    const next = within(dialog).getByRole("button", { name: "Next" })
    expect((previous as HTMLButtonElement).disabled).toBe(true)

    await user.click(next)
    expect(within(dialog).getByText("2 of 4 · Mixed grill")).toBeTruthy()
    expect((previous as HTMLButtonElement).disabled).toBe(false)
    await user.click(next)
    await user.click(next)
    expect(within(dialog).getByText("4 of 4 · Mixed grill")).toBeTruthy()
    expect(
      within(dialog).getByRole("img", {
        name: "Mixed grill, side view example",
      })
    ).toBeTruthy()
    expect((next as HTMLButtonElement).disabled).toBe(true)
    // Focus moved off the disabled Next instead of being lost.
    expect(document.activeElement).toBe(previous)

    await user.click(previous)
    expect(within(dialog).getByText("3 of 4 · Mixed grill")).toBeTruthy()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it("arrow keys move inside the viewer and stop at the ends", async () => {
    const user = userEvent.setup()
    render(<DishGuide suggested={[]} initialDish="curry" />)
    await user.click(tile(/^Side view/))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("4 of 4 · Curry")).toBeTruthy()
    await user.keyboard("{ArrowRight}")
    expect(within(dialog).getByText("4 of 4 · Curry")).toBeTruthy()
    await user.keyboard("{ArrowLeft}{ArrowLeft}")
    expect(within(dialog).getByText("2 of 4 · Curry")).toBeTruthy()
  })
})

describe("TaskPhotoGuide", () => {
  it.each([
    [1, "This section needs 1 photo. Start with the marked angle."],
    [2, "This section needs 2 photos. Start with the marked angles."],
    [3, "This section needs 3 photos. Start with the marked angles."],
    [4, "This section needs 4 photos. Use all four angles."],
    [9, "This section needs 9 photos. Use all four angles."],
    [0, ""],
    [null, ""],
  ])("lede for target %s", (target, expected) => {
    expect(guideLede(target)).toBe(expected)
  })

  it("renders the block with its lede and the full guide link", () => {
    render(<TaskPhotoGuide photoTarget={1} suggested={suggestedAngles(1)} />)
    const block = screen.getByRole("region", { name: "How to photograph it" })
    expect(
      within(block).getByText(
        "This section needs 1 photo. Start with the marked angle."
      )
    ).toBeTruthy()
    expect(within(block).getAllByText("Suggested")).toHaveLength(1)
    expect(within(block).getByText(/Examples, not your menu/)).toBeTruthy()
    expect(
      within(block)
        .getByRole("link", { name: "See the full photo guide" })
        .getAttribute("href")
    ).toBe(GUIDE_PATH)
    expect(GUIDE_PATH).toBe("/staff/tasks/guide")
  })
})
