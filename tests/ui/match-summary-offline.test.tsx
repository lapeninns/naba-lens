// @vitest-environment jsdom
// S3-E2E-1 E6 (AC09, DESIGN.md §6.8): offline, Match's end never claims a
// filled slot or Waiting for a photo still on the phone; it says the photo is
// saved on this phone and sends when the signal returns.
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  MatchScreen,
  type MatchOutcome,
  type SendState,
} from "@/components/nabalens/album/match/match-screen"
import type { MatchSlot } from "@/components/nabalens/album/match/model"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/staff/tasks",
}))

const SALAD: MatchSlot = {
  id: "dish:salad",
  name: "Salad",
  group: "Starters",
  place: null,
  placeLabel: "Not placed yet",
  brief: null,
  target: { kind: "dish", itemId: "salad", name: "Salad" },
}

const photo = {
  key: "m1-0",
  file: new File([new Uint8Array(8)], "a.jpg", { type: "image/jpeg" }),
}

function end(state: SendState) {
  render(
    <MatchScreen
      open
      photos={[photo]}
      outcomes={
        new Map<string, MatchOutcome>([
          [photo.key, { kind: "slot", slot: SALAD }],
        ])
      }
      sendStates={new Map([[photo.key, state]])}
      board={{ state: "loading" }}
      onRetryBoard={() => {}}
      current={null}
      last={null}
      venueName="The Bell"
      onDecide={() => {}}
      onClose={() => {}}
    />
  )
  return screen.getByRole("dialog")
}

beforeEach(() => {
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:x",
    revokeObjectURL: () => {},
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Match's end offline (E6)", () => {
  it("says saved on this phone, never filled or Waiting", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    const dialog = end("sending")
    expect(
      within(dialog).getByRole("heading", {
        name: "1 photo saved on this phone",
      })
    ).toBeTruthy()
    expect(
      within(dialog).getByText("They send when the signal returns.")
    ).toBeTruthy()
    const summary = dialog.querySelector('[data-slot="match-summary"]')!
    expect(summary.textContent).not.toMatch(/\b(Sent|Waiting|slots? filled)\b/)
  })

  it("counts the slot once the photo is on its way online", () => {
    const dialog = end("waiting")
    expect(
      within(dialog).getByRole("heading", { name: "1 slot filled" })
    ).toBeTruthy()
  })
})
