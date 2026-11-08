// @vitest-environment jsdom
// Coverage writes after a lost reply (the call rejected: offline, or the
// response never arrived) must not say "Nothing changed": the server may have
// applied the change. A refusal from the server keeps "Nothing changed." and
// shows the server's reason.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ManagerGrantView } from "@/components/nabalens/coverage/types"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

// A plain stand-in, not vi.fn(): Vitest's spy reports an async rejection as
// a test error even when the component catches it, which is the case here.
let revokeVenueManagerAction: (input: unknown) => Promise<unknown>
vi.mock("@/app/_coverage/actions", () => ({
  grantVenueManagerAction: vi.fn(),
  revokeVenueManagerAction: (input: unknown) => revokeVenueManagerAction(input),
}))

import { ManagersView } from "@/app/admin/coverage/managers/managers-view"
import {
  TeamRoster,
  type SetTargetHandler,
} from "@/components/nabalens/coverage"

import { PERIOD, monthly } from "./coverage-fixtures"

const VENUE = {
  id: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11",
  name: "TEST Railway",
}

const grant: ManagerGrantView = {
  id: "g-1",
  staff: {
    id: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
    displayName: "TEST Sam",
    active: true,
  },
  staffVenueId: VENUE.id,
  venue: VENUE,
  grantedBy: { id: "a", displayName: "TEST Admin" },
  grantedAt: "2026-11-01T09:00:00.000Z",
  grantReason: null,
  revokedAt: null,
  revokedByName: null,
  revokeKind: null,
  revokeReason: null,
  effective: true,
}

/** Rejects when called, like a Server Action whose reply never arrives. */
const lostReply = async () => {
  throw new TypeError("Failed to fetch")
}

beforeEach(() => {
  revokeVenueManagerAction = async () => ({ ok: true })
})
afterEach(cleanup)

describe("Revoke grant", () => {
  async function revoke() {
    render(
      <ManagersView
        grants={[grant]}
        venues={[VENUE]}
        selectedVenueId={null}
        candidates={[]}
        includeRevoked={false}
        basePath="/admin/coverage/managers"
      />
    )
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: "More actions for TEST Sam" })
    )
    await user.click(
      await screen.findByRole("menuitem", { name: "Revoke grant" })
    )
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Reason"), "Left the venue")
    await user.click(
      within(dialog).getByRole("button", { name: "Revoke grant" })
    )
    return dialog
  }

  it("a lost reply says the revoke couldn't be confirmed, never that nothing changed", async () => {
    revokeVenueManagerAction = lostReply
    const dialog = await revoke()
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toBe(
      "We couldn't confirm TEST is no longer TEST Railway's venue manager. Check your connection, then refresh to see."
    )
    expect(dialog.textContent).not.toContain("Nothing changed")
  })

  it("a refusal says nothing changed and gives the server's reason", async () => {
    revokeVenueManagerAction = async () => ({
      ok: false,
      code: "invalid_input",
      status: 400,
      message: "This grant has already ended.",
    })
    const dialog = await revoke()
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toBe(
      "Nothing changed. TEST is still TEST Railway's venue manager. This grant has already ended."
    )
  })
})

describe("Correct target", () => {
  const past = {
    ...PERIOD,
    key: "2026-10",
    label: "October 2026",
    isCurrent: false,
  }

  async function correct(onSetTarget: SetTargetHandler) {
    render(
      <TeamRoster
        period={past}
        currentPeriod="2026-11"
        rows={[monthly({ period: past })]}
        canEdit
        isAdmin
        basePath="/admin/coverage/v-1"
        venueName="TEST Venue"
        onSetTarget={onSetTarget}
      />
    )
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", {
        name: "Correct target for TEST Sam, October",
      })
    )
    const dialog = await screen.findByRole("dialog")
    await user.click(
      within(dialog).getByRole("button", {
        name: "Decrease TEST Sam's October target",
      })
    )
    await user.type(within(dialog).getByLabelText("Reason"), "On leave")
    await user.click(
      within(dialog).getByRole("button", { name: "Save correction" })
    )
    return dialog
  }

  it("a lost reply says the change couldn't be confirmed", async () => {
    const dialog = await correct(lostReply)
    const notice = await within(dialog).findByRole("alert")
    expect(notice.textContent).toContain("Couldn't confirm the correction")
    expect(notice.textContent).toContain(
      "We couldn't confirm the target changed. Check your connection, then refresh to see."
    )
    expect(dialog.textContent).not.toContain("Nothing changed")
  })

  it("a refusal says nothing changed, with the server's reason", async () => {
    const dialog = await correct(async () => ({
      ok: false,
      code: "invalid_input",
      status: 400,
      message: "Corrections need an admin.",
    }))
    const notice = await within(dialog).findByRole("alert")
    expect(notice.textContent).toContain("Couldn't save the correction")
    expect(notice.textContent).toContain(
      "Nothing changed. Corrections need an admin."
    )
  })
})
