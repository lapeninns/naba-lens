// @vitest-environment jsdom
// S3-R2 (S3-E2E-2 F6): "Still right" on Venue › To confirm keeps its
// announced status after the refreshed list no longer has the item.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => "/manager/venue/facts",
  useRouter: () => ({ refresh }),
}))

import {
  STILL_RIGHT_COPY,
  StillRightList,
  type StillRightItem,
} from "@/components/nabalens/manager/venue/still-right-list"

afterEach(cleanup)

const garden: StillRightItem = {
  id: "space:garden",
  title: "Garden",
  lines: ["1 photo due a check"],
  payload: { subjectId: "garden" },
  href: null,
}
const patio: StillRightItem = {
  id: "space:patio",
  title: "Patio",
  lines: ["1 photo due a check"],
  payload: { subjectId: "patio" },
  href: null,
}
const EMPTY = "No space photos are due a check."

describe("StillRightList after a refresh (F6)", () => {
  it("keeps the confirmed row and its status when the item leaves the list", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn(async () => ({ ok: true as const }))
    const { rerender } = render(
      <StillRightList
        label="Space photos"
        empty={EMPTY}
        onConfirm={onConfirm}
        items={[garden, patio]}
      />
    )
    expect(screen.queryByText(EMPTY)).toBeNull()
    await user.click(
      screen.getByRole("button", { name: "Still right: Garden" })
    )
    expect(onConfirm).toHaveBeenCalledWith({ subjectId: "garden" })
    expect(refresh).toHaveBeenCalled()

    // The server's list after router.refresh(): Garden is current again.
    rerender(
      <StillRightList
        label="Space photos"
        empty={EMPTY}
        onConfirm={onConfirm}
        items={[patio]}
      />
    )
    const list = screen.getByRole("list", { name: "Space photos" })
    const row = within(list).getByText("Garden").closest("li")!
    expect(within(row).getByRole("status").textContent).toContain(
      STILL_RIGHT_COPY.done
    )
    expect(within(row).queryByRole("button")).toBeNull()
    expect(
      screen.getByRole("button", { name: "Still right: Patio" })
    ).toBeTruthy()
    expect(screen.queryByText(EMPTY)).toBeNull()

    // Nothing left: the status stays and the empty text is shown too.
    rerender(
      <StillRightList
        label="Space photos"
        empty={EMPTY}
        onConfirm={onConfirm}
        items={[]}
      />
    )
    expect(screen.getByRole("status").textContent).toContain(
      STILL_RIGHT_COPY.done
    )
    expect(screen.getByText(EMPTY)).toBeTruthy()
  })

  it("shows only the empty text when there was nothing to confirm", () => {
    render(
      <StillRightList
        label="Space photos"
        empty={EMPTY}
        onConfirm={vi.fn()}
        items={[]}
      />
    )
    expect(screen.queryByRole("list")).toBeNull()
    expect(screen.getByText(EMPTY)).toBeTruthy()
  })
})
