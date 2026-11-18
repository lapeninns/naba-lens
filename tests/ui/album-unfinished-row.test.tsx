// @vitest-environment jsdom
// Spec §6 S1: under the Add action, Album Home shows photos that need the
// person — failed or stopped in this visit, or picked in an earlier visit
// and never finished. Nothing shows while there are none.
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UnfinishedRow } from "@/components/nabalens/album/unfinished-row"
import { AddProvider } from "@/components/nabalens/shell/add-context"

afterEach(cleanup)

describe("UnfinishedRow", () => {
  it("counts this visit's failed photos and earlier unfinished ones, and opens Add", async () => {
    const openAdd = vi.fn()
    render(
      <AddProvider value={{ openAdd, failed: 2, earlier: 1, active: 4 }}>
        <UnfinishedRow />
      </AddProvider>
    )
    const row = screen.getByRole("button", { name: /3 photos didn't finish/ })
    expect(row.textContent).toContain("Nothing is sent twice.")
    await userEvent.setup().click(row)
    expect(openAdd).toHaveBeenCalledTimes(1)
  })

  it("says one photo in the singular", () => {
    render(
      <AddProvider value={{ openAdd: vi.fn(), earlier: 1 }}>
        <UnfinishedRow />
      </AddProvider>
    )
    expect(
      screen.getByRole("button", { name: /1 photo didn't finish/ })
    ).toBeTruthy()
  })

  it("shows nothing while photos are only sending, or without Add", () => {
    const { container } = render(
      <AddProvider value={{ openAdd: vi.fn(), failed: 0, active: 3 }}>
        <UnfinishedRow />
      </AddProvider>
    )
    expect(container.textContent).toBe("")
    cleanup()
    const none = render(
      <AddProvider value={null}>
        <UnfinishedRow />
      </AddProvider>
    )
    expect(none.container.textContent).toBe("")
  })
})
