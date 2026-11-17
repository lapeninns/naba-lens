// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SlotTile, type SlotState } from "@/components/nabalens/album/slot-tile"

afterEach(cleanup)

// DESIGN.md §4: each state has its own frame, icon and word.
const CASES: Array<{
  state: SlotState
  name: string
  word: RegExp
  frame?: string
}> = [
  {
    state: "needed",
    name: "Guinness, pint: needed",
    word: /Add/,
    frame: "slot-needed",
  },
  { state: "sending", name: "Guinness, pint: sending", word: /Sending 40%/ },
  {
    state: "waiting",
    name: "Guinness, pint: waiting for review",
    word: /Waiting/,
  },
  {
    state: "retake",
    name: "Guinness, pint: needs another photo",
    word: /Retake/,
  },
  {
    state: "accepted",
    name: "Guinness, pint: in the album",
    word: /In the album/,
  },
  {
    state: "not-here",
    name: "Guinness, pint: not here",
    word: /Not here/,
    frame: "slot-not-here",
  },
]

describe("SlotTile", () => {
  it.each(CASES)(
    "names $state in words and draws its own frame",
    ({ state, name, word, frame }) => {
      render(
        <SlotTile
          name="Guinness, pint"
          state={state}
          progress={40}
          photoSrc="/p.jpg"
        />
      )
      const tile = screen.getByRole("group", { name })
      expect(tile.getAttribute("data-state")).toBe(state)
      expect(tile.textContent).toMatch(word)
      expect(tile.textContent).toContain("Guinness, pint")
      if (frame) expect(tile.className).toContain(frame)
    }
  )

  it("gives each state a different frame", () => {
    const frames = CASES.map(({ state }) => {
      const { container, unmount } = render(
        <SlotTile name="X" state={state} photoSrc="/p.jpg" />
      )
      const tile = container.querySelector('[data-slot="slot-tile"]')!
      const ring = tile.querySelector('[aria-hidden="true"].absolute')
      const signature = `${tile.className} | ${ring?.className ?? ""} | ${tile.textContent}`
      unmount()
      return signature
    })
    expect(new Set(frames).size).toBe(CASES.length)
  })

  it("rings a waiting photo and a retake differently", () => {
    const { container, rerender } = render(
      <SlotTile name="X" state="waiting" photoSrc="/p.jpg" />
    )
    expect(container.innerHTML).toContain("slot-ring-waiting")
    rerender(<SlotTile name="X" state="retake" photoSrc="/p.jpg" />)
    expect(container.innerHTML).toContain("slot-ring-retake")
    expect(container.innerHTML).not.toContain("slot-ring-waiting")
  })

  it("says a photo is held on the phone when offline", () => {
    render(<SlotTile name="Darts board" state="sending" offline />)
    expect(screen.getByText("Saved on this phone")).toBeTruthy()
  })

  it("is one link when it has somewhere to go", () => {
    render(
      <SlotTile
        name="Darts board"
        state="needed"
        href="/staff/add?slot=darts"
      />
    )
    const link = screen.getByRole("link", { name: "Darts board: needed" })
    expect(link.getAttribute("href")).toBe("/staff/add?slot=darts")
    expect(link.className).toContain("focus-ring")
  })

  it("is one button when it acts", async () => {
    const onSelect = vi.fn()
    render(<SlotTile name="Darts board" state="needed" onSelect={onSelect} />)
    await userEvent.click(
      screen.getByRole("button", { name: "Darts board: needed" })
    )
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it("keeps the Accepted tag apart from the main button's colours", () => {
    const { container } = render(
      <SlotTile name="X" state="accepted" photoSrc="/p.jpg" />
    )
    expect(container.innerHTML).toContain("bg-ok-fg")
    expect(container.innerHTML).not.toContain("bg-accent")
  })
})
