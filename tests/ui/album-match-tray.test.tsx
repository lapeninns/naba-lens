// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  type MatchOutcome,
  type MatchScreenProps,
} from "@/components/nabalens/album/match/match-screen"
import { MatchTray } from "@/components/nabalens/album/match/match-tray"
import type { MatchSlot } from "@/components/nabalens/album/match/model"

const naan: MatchSlot = {
  id: "dish:naan",
  target: { kind: "dish", itemId: "naan", name: "Garlic Cheese Naan" },
  name: "Garlic Cheese Naan",
  group: "Naans",
  place: null,
  placeLabel: "Kitchen pass",
  brief: "Show the full plate",
}

const photos = ["angle-one", "angle-two", "special"].map((name) => ({
  key: name,
  file: new File(["image"], `${name}.jpg`, { type: "image/jpeg" }),
}))

function setup(overrides: Partial<MatchScreenProps> = {}) {
  const props: MatchScreenProps = {
    open: true,
    photos,
    outcomes: new Map(),
    sendStates: new Map(),
    board: { state: "ready", board: { slots: [naan], amenities: [] } },
    onRetryBoard: vi.fn(),
    venueName: "Old Crown Girton Dev",
    current: null,
    last: null,
    onDecide: vi.fn(),
    onClose: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  }
  return { ...render(<MatchTray {...props} />), props }
}

afterEach(cleanup)

describe("two-route Batch Match", () => {
  it("keeps grouped assignments editable until Send and puts the rest in Match later", async () => {
    const { props } = setup()
    const user = userEvent.setup()
    const first = screen.getByRole("checkbox", { name: "angle-one.jpg" })
    const second = screen.getByRole("checkbox", { name: "angle-two.jpg" })
    expect((first as HTMLInputElement).checked).toBe(false)
    expect((second as HTMLInputElement).checked).toBe(false)
    await user.click(first)
    await user.click(second)
    await user.click(screen.getByRole("button", { name: "Choose slot" }))
    const sheet = await screen.findByRole("dialog", { name: "Choose slot" })
    await user.type(within(sheet).getByRole("searchbox"), "garl")
    await user.click(
      within(sheet).getByRole("button", { name: /Garlic Cheese Naan/ })
    )
    expect(props.onDecide).not.toHaveBeenCalled()
    expect(
      screen.getByRole("heading", { name: "Garlic Cheese Naan · 2" })
    ).toBeTruthy()
    await user.click(
      screen.getByRole("button", { name: "Send 2 · 1 to Match later" })
    )
    expect(props.onDecide).toHaveBeenNthCalledWith(
      1,
      "angle-one",
      { kind: "slot", slot: naan },
      undefined
    )
    expect(props.onDecide).toHaveBeenNthCalledWith(
      2,
      "angle-two",
      { kind: "slot", slot: naan },
      undefined
    )
    expect(props.onDecide).toHaveBeenNthCalledWith(
      3,
      "special",
      { kind: "later" },
      undefined
    )
  })

  it("keeps a missing search name as the note for the manager", async () => {
    const { props } = setup({ photos: [photos[2]] })
    const user = userEvent.setup()
    await user.click(screen.getByRole("checkbox", { name: "special.jpg" }))
    await user.click(screen.getByRole("button", { name: "Choose slot" }))
    const sheet = await screen.findByRole("dialog", { name: "Choose slot" })
    await user.type(within(sheet).getByRole("searchbox"), "Chef special")
    await user.click(
      within(sheet).getByRole("button", {
        name: /Ask my manager about “Chef special”/,
      })
    )
    await user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    expect(props.onDecide).toHaveBeenCalledWith(
      "special",
      { kind: "unsure" },
      "Chef special"
    )
  })

  it("counts only ready photos and retries the failed file", async () => {
    const assigned: MatchOutcome = { kind: "slot", slot: naan }
    const { props } = setup({
      outcomes: new Map(photos.map(({ key }) => [key, assigned])),
      sendStates: new Map([
        ["angle-one", "waiting"],
        ["angle-two", "failed"],
        ["special", "checking"],
      ]),
    })
    expect(screen.getByRole("status").textContent).toBe(
      "1 photo sent for review · Sending 1 photo · 1 needs attention"
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Retry angle-two.jpg" })
    )
    expect(props.onRetry).toHaveBeenCalledExactlyOnceWith("angle-two")
  })
})
