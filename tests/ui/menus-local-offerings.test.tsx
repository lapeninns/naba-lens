// @vitest-environment jsdom
// S1-MENUS screens: the activation dialog's confirmed retirements and
// schedule (AC27, AC28), the manager's dish controls (sold out keeps the
// photo request, AC26; local name; presentation changed) and the specials
// list (review at the end date; staff suggestions).
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))

import {
  OFFERING_COPY,
  OfferingControls,
  type OfferingControlsProps,
} from "@/app/manager/menu/_components/offering-controls"
import {
  SPECIAL_STATE_WORD,
  SpecialsList,
} from "@/app/manager/menu/_components/specials-panel"
import {
  ActivateMenuDialog,
  scheduleInstant,
} from "@/components/nabalens/menus"
import type { MenuSpecial } from "@/lib/server/menus/local"

afterEach(() => {
  cleanup()
  router.refresh.mockClear()
})

const ITEM = "00000000-0000-4000-8000-0000000000a1"

describe("ActivateMenuDialog retirements and schedule", () => {
  const READY = { unresolvedCount: 0, errorCount: 0, itemCount: 4 }

  it("lists proposed retirements and activates only once they are ticked", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    render(
      <ActivateMenuDialog
        open
        onOpenChange={vi.fn()}
        versionTitle="Winter"
        currentActiveTitle="Autumn"
        retirements={["Dal", "Soup"]}
        {...READY}
        onConfirm={onConfirm}
      />
    )
    expect(
      screen.getByText(/2 items on the current menu are not in this draft/)
    ).toBeTruthy()
    const activate = screen.getByRole("button", {
      name: "Activate for labelling",
    })
    expect((activate as HTMLButtonElement).disabled).toBe(true)
    await user.click(
      screen.getByRole("checkbox", {
        name: /Retire them from current coverage/,
      })
    )
    await user.click(activate)
    expect(onConfirm).toHaveBeenCalledWith({ retirements: 2, at: null })
  })

  it("schedules for a chosen time instead of activating now", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    render(
      <ActivateMenuDialog
        open
        onOpenChange={vi.fn()}
        versionTitle="Winter"
        allowSchedule
        {...READY}
        onConfirm={onConfirm}
      />
    )
    await user.click(
      screen.getByRole("checkbox", { name: /Schedule for later/ })
    )
    const button = screen.getByRole("button", { name: "Schedule activation" })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText("Activate at"), "2026-12-01T09:00")
    await user.click(button)
    expect(onConfirm).toHaveBeenCalledWith({
      retirements: 0,
      at: scheduleInstant("2026-12-01T09:00"),
    })
  })

  it("reads datetime-local values only", () => {
    expect(scheduleInstant("2026-12-01T09:00")).toMatch(/^2026-1[12]-/)
    expect(scheduleInstant("tomorrow")).toBeNull()
  })
})

function controls(over: Partial<OfferingControlsProps> = {}) {
  const actions = {
    setAvailability: vi.fn().mockResolvedValue({ ok: true, changed: true }),
    setDisplayName: vi.fn().mockResolvedValue({ ok: true, changed: true }),
    presentationChanged: vi.fn().mockResolvedValue({
      ok: true,
      presentationRevision: 2,
      photosToRecheck: 1,
    }),
    requestChange: vi.fn().mockResolvedValue({ ok: true, requestId: "r" }),
  }
  render(
    <OfferingControls
      itemId={ITEM}
      menuName="Korma"
      today="2026-11-18"
      state={{
        available: true,
        unavailableUntil: null,
        unavailableReason: null,
        displayName: null,
      }}
      actions={actions}
      {...over}
    />
  )
  return actions
}

const card = (title: string) => screen.getByRole("region", { name: title })

describe("OfferingControls", () => {
  it("marks a dish not available with a reason, and says its photo request stays", async () => {
    const user = userEvent.setup()
    const actions = controls()
    const availability = card(OFFERING_COPY.availability.title)
    expect(availability.textContent).toContain(OFFERING_COPY.availability.keeps)
    await user.type(
      within(availability).getByLabelText(OFFERING_COPY.availability.reason),
      "Sold out"
    )
    await user.click(
      within(availability).getByRole("button", {
        name: OFFERING_COPY.availability.markOff,
      })
    )
    expect(actions.setAvailability).toHaveBeenCalledWith({
      itemId: ITEM,
      available: false,
      reason: "Sold out",
      until: "",
    })
    expect(router.refresh).toHaveBeenCalled()
  })

  it("shows an unavailable dish and puts it back on", async () => {
    const user = userEvent.setup()
    const actions = controls({
      state: {
        available: false,
        unavailableUntil: "2026-11-20",
        unavailableReason: "Supplier",
        displayName: null,
      },
    })
    const availability = card(OFFERING_COPY.availability.title)
    expect(availability.textContent).toContain("Not on until 2026-11-20.")
    await user.click(
      within(availability).getByRole("button", {
        name: OFFERING_COPY.availability.markOn,
      })
    )
    expect(actions.setAvailability).toHaveBeenCalledWith({
      itemId: ITEM,
      available: true,
    })
  })

  it("reports a refused change in the card", async () => {
    const user = userEvent.setup()
    const actions = controls()
    actions.presentationChanged.mockResolvedValueOnce({
      ok: false,
      error: "You can only change menus at your own venue.",
    })
    const presentation = card(OFFERING_COPY.presentation.title)
    await user.type(
      within(presentation).getByLabelText(OFFERING_COPY.presentation.note),
      "New plate"
    )
    await user.click(
      within(presentation).getByRole("button", {
        name: OFFERING_COPY.presentation.save,
      })
    )
    expect(presentation.textContent).toContain(
      "You can only change menus at your own venue."
    )
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it("says how many photos go back for a recheck", async () => {
    const user = userEvent.setup()
    controls()
    const presentation = card(OFFERING_COPY.presentation.title)
    await user.type(
      within(presentation).getByLabelText(OFFERING_COPY.presentation.note),
      "New plate"
    )
    await user.click(
      within(presentation).getByRole("button", {
        name: OFFERING_COPY.presentation.save,
      })
    )
    expect(presentation.textContent).toContain(
      OFFERING_COPY.presentation.done(1)
    )
  })
})

function special(over: Partial<MenuSpecial>): MenuSpecial {
  return {
    specialId: "00000000-0000-4000-8000-0000000000d1",
    itemId: ITEM,
    name: "Game pie",
    description: null,
    kind: "food",
    startsOn: "2026-11-01",
    endsOn: "2026-11-10",
    state: "running",
    mine: false,
    decisionReason: null,
    revision: 3,
    ...over,
  }
}

describe("SpecialsList", () => {
  it("asks to end or extend a special at its end date", async () => {
    const user = userEvent.setup()
    const review = vi.fn().mockResolvedValue({ ok: true, status: "ended" })
    render(
      <SpecialsList
        specials={[special({ state: "review_due" })]}
        today="2026-11-18"
        decide={vi.fn()}
        review={review}
      />
    )
    expect(
      screen.getByText(new RegExp(SPECIAL_STATE_WORD.review_due))
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "End it" }))
    expect(review).toHaveBeenCalledWith({
      specialId: "00000000-0000-4000-8000-0000000000d1",
      revision: 3,
      action: "end",
    })
  })

  it("accepts a staff suggestion, and declines one with a reason", async () => {
    const user = userEvent.setup()
    const decide = vi.fn().mockResolvedValue({ ok: true, status: "running" })
    render(
      <SpecialsList
        specials={[special({ state: "suggested", revision: 1 })]}
        today="2026-11-18"
        decide={decide}
        review={vi.fn()}
      />
    )
    await user.type(
      screen.getByLabelText("Reason (needed to decline)"),
      "Not this week"
    )
    await user.click(screen.getByRole("button", { name: "Decline" }))
    expect(decide).toHaveBeenLastCalledWith(
      expect.objectContaining({ accept: false, reason: "Not this week" })
    )
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(decide).toHaveBeenLastCalledWith(
      expect.objectContaining({ accept: true, reason: null })
    )
  })
})
