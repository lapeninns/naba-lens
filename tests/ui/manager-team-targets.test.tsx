// @vitest-environment jsdom
// G-6: the /manager team screen. The venue default and each person's number
// this month; a reason for any change to a number someone already has; no
// due dates; people listed by name, never by progress.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { TeamTargets } from "@/components/nabalens/manager/team/team-targets"
import type { VenueTargetsView } from "@/lib/server/coverage/targets"

import { monthly, PERIOD, person } from "./coverage-fixtures"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

afterEach(() => {
  cleanup()
  refresh.mockReset()
})

const copy = MANAGER_COPY.team

const ZOE = monthly({
  person: person({
    id: "00000000-0000-4000-8000-0000000000e1",
    displayName: "Zoe Adams",
  }),
  source: "venue_default",
  targetCount: 6,
  revision: 1,
  accepted: 5,
  due: null,
})
const AMY = monthly({
  person: person({
    id: "00000000-0000-4000-8000-0000000000e2",
    displayName: "Amy Zed",
  }),
  source: "manager",
  targetCount: 3,
  revision: 2,
  accepted: 0,
  due: null,
})
const NEW = monthly({
  person: person({
    id: "00000000-0000-4000-8000-0000000000e3",
    displayName: "Kim Bell",
  }),
  source: "placeholder",
  targetCount: null,
  revision: 1,
  status: "needs_setup",
  setupMissing: ["target"],
  accepted: 0,
  due: null,
})

function view(over: Partial<VenueTargetsView> = {}): VenueTargetsView {
  return {
    period: PERIOD,
    venueDefault: { targetCount: 6, revision: 1 },
    wholeVenue: false,
    people: [ZOE, AMY, NEW],
    ...over,
  }
}

function setup(v: VenueTargetsView = view()) {
  const onSetDefault = vi.fn().mockResolvedValue({ ok: true, targetCount: 8 })
  const onSetPerson = vi.fn().mockResolvedValue({ ok: true, revision: 3 })
  const user = userEvent.setup()
  render(
    <TeamTargets
      view={v}
      onSetDefault={onSetDefault}
      onSetPerson={onSetPerson}
    />
  )
  return { user, onSetDefault, onSetPerson }
}

const rows = () =>
  within(screen.getByRole("region", { name: copy.peopleTitle })).getAllByRole(
    "listitem"
  )

describe("TeamTargets", () => {
  it("lists Needs setup first, then by surname, with where each number comes from", () => {
    setup()
    const names = rows().map(
      (li) => within(li).getAllByText(/^(Kim|Zoe|Amy)/)[0]!.textContent
    )
    expect(names).toEqual(["Kim Bell", "Zoe Adams", "Amy Zed"])
    expect(screen.getByText("6 photos · Venue default")).toBeTruthy()
    expect(screen.getByText("3 photos · Set by a manager")).toBeTruthy()
    expect(within(rows()[0]!).getByText("Needs setup")).toBeTruthy()
    expect(screen.queryByText(/due|overdue/i)).toBeNull()
    // One blue primary on the screen.
    expect(
      screen
        .getAllByRole("button")
        .filter((b) => b.className.includes("bg-accent"))
    ).toHaveLength(1)
  })

  it("sets a first default without a reason", async () => {
    const { user, onSetDefault } = setup(
      view({ venueDefault: { targetCount: null, revision: null } })
    )
    expect(screen.getByText(copy.defaultUnset)).toBeTruthy()
    expect(screen.queryByLabelText(copy.reasonLabel)).toBeNull()
    await user.click(
      screen.getByRole("button", { name: `Increase ${copy.defaultName}` })
    )
    await user.click(screen.getByRole("button", { name: copy.saveDefault }))
    expect(onSetDefault).toHaveBeenCalledWith({
      targetCount: 1,
      expectedRevision: null,
    })
    expect(await screen.findByText(copy.defaultSaved)).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
  })

  it("asks for a reason to change or clear a set default", async () => {
    const { user, onSetDefault } = setup()
    await user.click(
      screen.getByRole("button", { name: `Increase ${copy.defaultName}` })
    )
    await user.click(screen.getByRole("button", { name: copy.saveDefault }))
    expect(onSetDefault).not.toHaveBeenCalled()
    expect(screen.getByText("Enter a reason.")).toBeTruthy()
    await user.type(screen.getByLabelText(copy.reasonLabel), "Busier month")
    await user.click(screen.getByRole("button", { name: copy.saveDefault }))
    expect(onSetDefault).toHaveBeenCalledWith({
      targetCount: 7,
      reason: "Busier month",
      expectedRevision: 1,
    })
    await user.click(screen.getByRole("button", { name: copy.clearDefault }))
    expect(onSetDefault).toHaveBeenLastCalledWith({
      targetCount: null,
      reason: "Busier month",
      expectedRevision: 1,
    })
  })

  it("sets a person's own number; a reason when they already have one", async () => {
    const { user, onSetPerson } = setup()
    const row = (name: string) =>
      within(rows().find((li) => within(li).queryByText(name))!)
    await user.click(
      screen.getByRole("button", { name: copy.change("Kim Bell") })
    )
    // A placeholder has no number yet: no reason.
    expect(row("Kim Bell").queryByLabelText(copy.reasonLabel)).toBeNull()
    await user.type(screen.getByLabelText(copy.personName("Kim Bell")), "4")
    await user.click(
      row("Kim Bell").getByRole("button", { name: copy.savePerson })
    )
    expect(onSetPerson).toHaveBeenCalledWith({
      staffId: NEW.person.id,
      targetCount: 4,
      expectedRevision: 1,
    })
    expect(await screen.findByText(copy.personSaved("Kim Bell"))).toBeTruthy()

    await user.click(
      screen.getByRole("button", { name: copy.change("Zoe Adams") })
    )
    await user.click(
      row("Zoe Adams").getByRole("button", { name: copy.savePerson })
    )
    expect(onSetPerson).toHaveBeenCalledTimes(1)
    expect(row("Zoe Adams").getByText("Enter a reason.")).toBeTruthy()
    await user.type(
      row("Zoe Adams").getByLabelText(copy.reasonLabel),
      "Part time"
    )
    await user.click(
      row("Zoe Adams").getByRole("button", { name: copy.savePerson })
    )
    expect(onSetPerson).toHaveBeenLastCalledWith({
      staffId: ZOE.person.id,
      targetCount: 6,
      reason: "Part time",
      expectedRevision: 1,
    })
  })

  it("shows a refused save and re-reads after a conflict", async () => {
    const { user, onSetDefault } = setup()
    onSetDefault.mockResolvedValueOnce({
      ok: false,
      code: "revision_conflict",
      status: 409,
      message: "changed",
      currentRevision: 2,
    })
    await user.type(screen.getByLabelText(copy.reasonLabel), "Why")
    await user.click(
      screen.getByRole("button", { name: `Increase ${copy.defaultName}` })
    )
    await user.click(screen.getByRole("button", { name: copy.saveDefault }))
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
  })

  it("locks every number when the venue has one target for the whole team", () => {
    setup(view({ wholeVenue: true }))
    expect(screen.getByText(copy.wholeVenue)).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: copy.change("Zoe Adams") })
    ).toBeNull()
    expect(
      (
        screen.getByRole("button", {
          name: copy.saveDefault,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })
})
