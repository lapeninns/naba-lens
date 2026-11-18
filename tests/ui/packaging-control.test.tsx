// @vitest-environment jsdom
// FA-51 packaged drinks: the Packaged and Photo wanted switches ask once,
// without a reason, before they change (PackagingControl); an optional
// slot's empty tile reads Optional in a plain edge, never Needed's dashed
// frame (SlotTile, DESIGN.md §4).
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))

import { SlotTile } from "@/components/nabalens/album/slot-tile"
import {
  PACKAGING_COPY,
  PackagingControl,
} from "@/components/nabalens/manager/menu/packaging-control"

afterEach(() => {
  cleanup()
  router.refresh.mockClear()
})

const ITEM = "00000000-0000-4000-8000-0000000000a1"
const text = (el: Element) => el.textContent ?? ""

describe("PackagingControl", () => {
  it("asks before marking an item packaged, with no reason, then saves", async () => {
    const user = userEvent.setup()
    const setAction = vi.fn().mockResolvedValue({ ok: true })
    render(
      <PackagingControl
        itemId={ITEM}
        name="Bottled lager"
        value={{ packaged: false, photoWanted: false }}
        setAction={setAction}
      />
    )
    expect(text(screen.getByTestId("packaging-state"))).toBe(
      "Counts in coverage."
    )
    // Photo wanted waits for Packaged.
    const wanted = screen.getByRole("switch", { name: /Photo wanted/ })
    expect(wanted.getAttribute("aria-disabled")).toBe("true")
    expect(screen.getByText(PACKAGING_COPY.photoWantedOff)).toBeTruthy()

    await user.click(screen.getByRole("switch", { name: /Packaged/ }))
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText("Mark Bottled lager as packaged?")
    ).toBeTruthy()
    expect(within(dialog).queryByRole("textbox")).toBeNull()
    expect(setAction).not.toHaveBeenCalled()

    await user.click(
      within(dialog).getByRole("button", { name: "Mark as packaged" })
    )
    expect(setAction).toHaveBeenCalledWith({
      itemId: ITEM,
      packaged: true,
      photoWanted: false,
    })
    expect(await screen.findByText(PACKAGING_COPY.saved)).toBeTruthy()
    expect(text(screen.getByTestId("packaging-state"))).toBe(
      "Packaged. Optional: not counted in coverage."
    )
    expect(router.refresh).toHaveBeenCalled()
  })

  it("changes nothing when the confirm is cancelled", async () => {
    const user = userEvent.setup()
    const setAction = vi.fn()
    render(
      <PackagingControl
        itemId={ITEM}
        name="Bottled lager"
        value={{ packaged: true, photoWanted: false }}
        setAction={setAction}
      />
    )
    await user.click(screen.getByRole("switch", { name: /Photo wanted/ }))
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText("Ask for a photo of Bottled lager?")
    ).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(setAction).not.toHaveBeenCalled()
    expect(
      screen
        .getByRole("switch", { name: /Photo wanted/ })
        .getAttribute("aria-checked")
    ).toBe("false")
  })

  it("names the venue for an admin and shows a refusal", async () => {
    const user = userEvent.setup()
    const setAction = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Not allowed." })
    render(
      <ul>
        <PackagingControl
          variant="row"
          itemId={ITEM}
          name="Canned cola"
          detail="Soft drinks"
          venueId="00000000-0000-4000-8000-0000000000b1"
          value={{ packaged: true, photoWanted: true }}
          setAction={setAction}
        />
      </ul>
    )
    expect(
      screen.getByText(
        "Soft drinks · Packaged. A photo is wanted, so it counts in coverage."
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("switch", { name: /Packaged/ }))
    const dialog = await screen.findByRole("alertdialog")
    await user.click(
      within(dialog).getByRole("button", { name: "Mark as not packaged" })
    )
    expect(setAction).toHaveBeenCalledWith({
      itemId: ITEM,
      venueId: "00000000-0000-4000-8000-0000000000b1",
      packaged: false,
      photoWanted: false,
    })
    expect(await screen.findByText("Not allowed.")).toBeTruthy()
  })
})

describe("SlotTile optional (FA-51)", () => {
  it("reads Optional in a plain edge when empty, never the dashed frame", () => {
    render(<SlotTile name="Bottled lager" state="needed" optional href="#x" />)
    const tile = screen.getByRole("link", { name: "Bottled lager: optional" })
    expect(text(tile)).toContain("Optional")
    expect(tile.className).not.toContain("slot-needed")
    expect(tile.getAttribute("data-optional")).toBe("true")
  })

  it("draws its photo state as usual once it has one", () => {
    render(
      <SlotTile
        name="Bottled lager"
        state="accepted"
        optional
        photoSrc="/x.jpg"
      />
    )
    const tile = screen.getByRole("group", {
      name: "Bottled lager: in the album",
    })
    expect(text(tile)).toContain("In the album")
  })
})
