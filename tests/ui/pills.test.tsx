// @vitest-environment jsdom
import * as React from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

afterEach(cleanup)

const MEDIA = [
  { value: "all", label: "All" },
  { value: "photos", label: "Photos" },
  { value: "videos", label: "Videos" },
] as const

describe("SegmentedControl", () => {
  it("is a named radio group with one radio per option", () => {
    render(
      <SegmentedControl label="Media" options={MEDIA} defaultValue="all" />
    )
    const group = screen.getByRole("radiogroup", { name: "Media" })
    expect(group.getAttribute("data-slot")).toBe("segmented-control")
    expect(group.getAttribute("data-size")).toBe("sm")
    expect(group.getAttribute("data-width")).toBe("full")
    const radios = within(group).getAllByRole("radio")
    expect(radios.map((radio) => radio.textContent)).toEqual([
      "All",
      "Photos",
      "Videos",
    ])
    for (const radio of radios) {
      expect(radio.tagName).toBe("BUTTON")
      expect(radio.getAttribute("data-slot")).toBe("segmented-control-item")
      expect(radio.className).toContain("min-h-11")
      expect(radio.className).toContain("focus-ring")
    }
    expect(
      screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")
    ).toBe("true")
    expect(
      screen.getByRole("radio", { name: "Photos" }).getAttribute("aria-checked")
    ).toBe("false")
  })

  it("draws the grey track and the raised chosen segment from tokens", () => {
    render(
      <SegmentedControl label="Media" options={MEDIA} defaultValue="all" />
    )
    const group = screen.getByRole("radiogroup")
    for (const name of ["bg-surface-2", "rounded-round", "p-1", "gap-1"]) {
      expect(group.className).toContain(name)
    }
    const radio = screen.getByRole("radio", { name: "All" })
    for (const name of [
      "aria-checked:bg-surface",
      "aria-checked:shadow-control",
      "aria-checked:ring-edge-strong",
    ]) {
      expect(radio.className).toContain(name)
    }
  })

  it("takes its name from a visible label when given one", () => {
    render(
      <>
        <h2 id="appearance">Appearance</h2>
        <p id="appearance-help">System follows this device.</p>
        <SegmentedControl
          label="Ignored"
          aria-labelledby="appearance"
          aria-describedby="appearance-help"
          options={MEDIA}
        />
      </>
    )
    const group = screen.getByRole("radiogroup", { name: "Appearance" })
    expect(group.getAttribute("aria-label")).toBeNull()
    expect(group.getAttribute("aria-describedby")).toBe("appearance-help")
  })

  it("changes on click when uncontrolled", async () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        label="Media"
        options={MEDIA}
        defaultValue="all"
        onValueChange={onValueChange}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: "Videos" }))
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith("videos")
    expect(
      screen.getByRole("radio", { name: "Videos" }).getAttribute("aria-checked")
    ).toBe("true")
    expect(
      screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")
    ).toBe("false")
  })

  it("follows the value it is given when controlled", async () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <SegmentedControl
        label="Media"
        options={MEDIA}
        value="all"
        onValueChange={onValueChange}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: "Photos" }))
    expect(onValueChange).toHaveBeenCalledWith("photos")
    // Nothing moves until the owner passes the new value down.
    expect(
      screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")
    ).toBe("true")
    rerender(
      <SegmentedControl
        label="Media"
        options={MEDIA}
        value="photos"
        onValueChange={onValueChange}
      />
    )
    expect(
      screen.getByRole("radio", { name: "Photos" }).getAttribute("aria-checked")
    ).toBe("true")
  })

  it("leaves no segment chosen for a value that matches none", () => {
    render(
      <SegmentedControl<"all" | "photos" | "videos" | "">
        label="Media"
        options={MEDIA}
        value=""
      />
    )
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-checked")).toBe("false")
    }
  })

  it("is one tab stop, and arrow keys move and choose", async () => {
    const onValueChange = vi.fn()
    render(
      <>
        <button type="button">Before</button>
        <SegmentedControl
          label="Media"
          options={MEDIA}
          defaultValue="photos"
          onValueChange={onValueChange}
        />
        <button type="button">After</button>
      </>
    )
    const user = userEvent.setup()
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Photos" })
    )
    await user.keyboard("{ArrowRight}")
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Videos" })
    )
    expect(onValueChange).toHaveBeenLastCalledWith("videos")
    await user.keyboard("{ArrowLeft}{ArrowLeft}")
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "All" })
    )
    expect(onValueChange).toHaveBeenLastCalledWith("all")
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "After" })
    )
  })

  it("sends its value with a native form under its name", async () => {
    render(
      <form data-testid="form">
        <SegmentedControl
          name="media"
          label="Media"
          options={MEDIA}
          defaultValue="all"
        />
      </form>
    )
    const form = screen.getByTestId<HTMLFormElement>("form")
    expect(new FormData(form).get("media")).toBe("all")
    await userEvent.click(screen.getByRole("radio", { name: "Videos" }))
    expect(new FormData(form).get("media")).toBe("videos")
  })

  it("skips a segment that is switched off and marks it with an icon", async () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        label="Media"
        defaultValue="all"
        onValueChange={onValueChange}
        options={[
          { value: "all", label: "All" },
          { value: "photos", label: "Photos", disabled: true },
          { value: "videos", label: "Videos" },
        ]}
      />
    )
    const off = screen.getByRole("radio", { name: "Photos" })
    expect(off.hasAttribute("data-disabled")).toBe(true)
    expect(
      off.querySelector('[data-slot="segmented-control-off"]')
    ).not.toBeNull()
    await userEvent.click(off)
    expect(onValueChange).not.toHaveBeenCalled()
    expect(off.getAttribute("aria-checked")).toBe("false")
  })

  it("switches every segment off when the group is disabled", async () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        label="Media"
        options={MEDIA}
        defaultValue="all"
        disabled
        onValueChange={onValueChange}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: "Videos" }))
    expect(onValueChange).not.toHaveBeenCalled()
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.hasAttribute("data-disabled")).toBe(true)
    }
  })

  it("marks the track when invalid and points at the message", () => {
    render(
      <>
        <SegmentedControl
          label="Media"
          options={MEDIA}
          aria-invalid
          aria-describedby="media-error"
        />
        <p id="media-error">Choose a media type.</p>
      </>
    )
    const group = screen.getByRole("radiogroup")
    expect(group.getAttribute("aria-invalid")).toBe("true")
    expect(group.getAttribute("aria-describedby")).toBe("media-error")
    expect(group.className).toContain("aria-invalid:edge-invalid")
  })

  it("takes items as children, with icons, and the fit and stack layouts", () => {
    render(
      <SegmentedControl
        label="View"
        width="fit"
        stack="phone"
        defaultValue="grid"
        className="mt-2"
      >
        <SegmentedControlItem value="grid" icon={<svg data-testid="icon" />}>
          Grid
        </SegmentedControlItem>
        <SegmentedControlItem value="list">List</SegmentedControlItem>
      </SegmentedControl>
    )
    const group = screen.getByRole("radiogroup", { name: "View" })
    expect(group.getAttribute("data-width")).toBe("fit")
    expect(group.getAttribute("data-stack")).toBe("phone")
    expect(group.className).toContain("w-fit")
    expect(group.className).toContain("max-md:rounded-card")
    expect(group.className).toContain("mt-2")
    const grid = screen.getByRole("radio", { name: "Grid" })
    expect(grid.getAttribute("aria-checked")).toBe("true")
    expect(
      screen.getByTestId("icon").parentElement?.getAttribute("aria-hidden")
    ).toBe("true")
  })
})

describe("FilterPill", () => {
  it("is a pressed button in toggle mode, with a tick when on", async () => {
    const onClick = vi.fn()
    const { rerender } = render(
      <FilterPill onClick={onClick}>Mains</FilterPill>
    )
    const pill = screen.getByRole("button", { name: "Mains" })
    expect(pill.tagName).toBe("BUTTON")
    expect(pill.getAttribute("type")).toBe("button")
    expect(pill.getAttribute("data-slot")).toBe("filter-pill")
    expect(pill.getAttribute("data-mode")).toBe("toggle")
    expect(pill.getAttribute("data-size")).toBe("sm")
    expect(pill.getAttribute("aria-pressed")).toBe("false")
    expect(pill.hasAttribute("data-selected")).toBe(false)
    expect(pill.querySelector('[data-slot="filter-pill-tick"]')).toBeNull()
    for (const name of [
      "min-h-11",
      "rounded-round",
      "bg-surface",
      "edge-strong",
      "focus-ring",
      "text-ink",
    ]) {
      expect(pill.className).toContain(name)
    }
    await userEvent.click(pill)
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(
      <FilterPill selected onClick={onClick}>
        Mains
      </FilterPill>
    )
    const on = screen.getByRole("button", { name: "Mains" })
    expect(on.getAttribute("aria-pressed")).toBe("true")
    expect(on.hasAttribute("data-selected")).toBe(true)
    // v2 PickChip: an ink fill with paper (canvas) text, and the tick.
    expect(on.className.split(" ")).toContain("bg-ink")
    expect(on.className.split(" ")).toContain("text-canvas")
    const tick = on.querySelector('[data-slot="filter-pill-tick"]')
    expect(tick?.getAttribute("aria-hidden")).toBe("true")
  })

  it("answers Enter and Space in toggle mode", async () => {
    const onClick = vi.fn()
    render(<FilterPill onClick={onClick}>Mains</FilterPill>)
    const user = userEvent.setup()
    await user.tab()
    await user.keyboard("{Enter}")
    await user.keyboard(" ")
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it("is a link in link mode, and the one that is on is the current page", () => {
    render(
      <>
        <FilterPill href="/menu?section=mains" selected>
          Mains
        </FilterPill>
        <FilterPill href="/menu?section=starters">Starters</FilterPill>
        <FilterPill href="/menu?sort=name" selected current="true">
          By name
        </FilterPill>
      </>
    )
    const on = screen.getByRole("link", { name: "Mains" })
    expect(on.tagName).toBe("A")
    expect(on.getAttribute("href")).toBe("/menu?section=mains")
    expect(on.getAttribute("data-mode")).toBe("link")
    expect(on.getAttribute("aria-current")).toBe("page")
    expect(on.hasAttribute("aria-pressed")).toBe(false)
    expect(on.querySelector('[data-slot="filter-pill-tick"]')).not.toBeNull()
    const off = screen.getByRole("link", { name: "Starters" })
    expect(off.hasAttribute("aria-current")).toBe(false)
    expect(off.querySelector('[data-slot="filter-pill-tick"]')).toBeNull()
    expect(
      screen.getByRole("link", { name: "By name" }).getAttribute("aria-current")
    ).toBe("true")
  })

  it("shows a count in the mono face as part of the name", () => {
    render(<FilterPill count={12}>Waiting</FilterPill>)
    const pill = screen.getByRole("button", { name: "Waiting 12" })
    const count = pill.querySelector('[data-slot="filter-pill-count"]')
    expect(count?.textContent).toBe("12")
    expect(count?.className).toContain("font-mono")
  })

  it("shows a zero count", () => {
    render(<FilterPill count={0}>Waiting</FilterPill>)
    expect(screen.getByRole("button", { name: "Waiting 0" })).toBeTruthy()
  })

  it("reads as a remove action when removable", async () => {
    const onClick = vi.fn()
    render(
      <FilterPill removable onClick={onClick}>
        Lamb bhuna
      </FilterPill>
    )
    const pill = screen.getByRole("button", {
      name: "Remove filter: Lamb bhuna",
    })
    expect(pill.hasAttribute("aria-pressed")).toBe(false)
    expect(pill.hasAttribute("data-removable")).toBe(true)
    expect(pill.className.split(" ")).toContain("bg-ink")
    expect(
      pill.querySelector('[data-slot="filter-pill-remove"]')
    ).not.toBeNull()
    expect(pill.querySelector('[data-slot="filter-pill-tick"]')).toBeNull()
    await userEvent.click(pill)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("is a plain link with no current state when removable in link mode", () => {
    render(
      <FilterPill href="/review" removable removeLabel="Stop showing only">
        Lamb bhuna
      </FilterPill>
    )
    const pill = screen.getByRole("link", {
      name: "Stop showing only Lamb bhuna",
    })
    expect(pill.hasAttribute("aria-current")).toBe(false)
    expect(pill.getAttribute("href")).toBe("/review")
  })

  it("stays focusable, does nothing and gives its reason when blocked", async () => {
    const onClick = vi.fn()
    render(
      <FilterPill
        disabledReason="No videos have been sent yet."
        onClick={onClick}
      >
        Videos
      </FilterPill>
    )
    const pill = screen.getByRole("button", { name: "Videos" })
    expect(pill.getAttribute("aria-disabled")).toBe("true")
    expect(pill.hasAttribute("disabled")).toBe(false)
    expect(pill.querySelector('[data-slot="filter-pill-off"]')).not.toBeNull()
    expect(pill.className).toContain("cursor-not-allowed")
    const reason = document.getElementById(
      pill.getAttribute("aria-describedby") ?? ""
    )
    expect(reason?.textContent).toBe("No videos have been sent yet.")
    expect(pill.contains(reason)).toBe(false)
    const user = userEvent.setup()
    await user.tab()
    expect(document.activeElement).toBe(pill)
    await user.click(pill)
    await user.keyboard("{Enter}")
    expect(onClick).not.toHaveBeenCalled()
  })

  it("keeps a caller's description beside the reason", () => {
    render(
      <>
        <FilterPill aria-describedby="note" disabledReason="Offline.">
          Videos
        </FilterPill>
        <p id="note">Filters apply at once.</p>
      </>
    )
    const ids = screen
      .getByRole("button", { name: "Videos" })
      .getAttribute("aria-describedby")
      ?.split(" ")
    expect(ids?.[0]).toBe("note")
    expect(ids).toHaveLength(2)
  })

  it("is a link with nowhere to go when blocked in link mode", async () => {
    render(
      <FilterPill href="/menu?section=mains" aria-disabled="true">
        Mains
      </FilterPill>
    )
    const pill = screen.getByRole("link", { name: "Mains" })
    expect(pill.tagName).toBe("SPAN")
    expect(pill.hasAttribute("href")).toBe(false)
    expect(pill.getAttribute("aria-disabled")).toBe("true")
    await userEvent.tab()
    expect(document.activeElement).toBe(pill)
  })

  it("a blocked link-mode pill runs none of the caller's handlers", async () => {
    const onClick = vi.fn()
    const onKeyDown = vi.fn()
    const onFocus = vi.fn()
    render(
      <FilterPill
        href="/menu?section=mains"
        disabledReason="No mains on this menu."
        onClick={onClick}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
      >
        Mains
      </FilterPill>
    )
    const pill = screen.getByRole("link", { name: "Mains" })
    const user = userEvent.setup()
    await user.click(pill)
    await user.keyboard("{Enter}")
    expect(onClick).not.toHaveBeenCalled()
    expect(onKeyDown).not.toHaveBeenCalled()
    // Focus is not an action: the caller may still follow it.
    expect(onFocus).toHaveBeenCalled()
  })

  it("merges a caller's class last", () => {
    render(<FilterPill className="w-full bg-surface-2">Mains</FilterPill>)
    const pill = screen.getByRole("button", { name: "Mains" })
    expect(pill.className).toContain("w-full")
    expect(pill.className.split(" ")).toContain("bg-surface-2")
    expect(pill.className.split(" ")).not.toContain("bg-surface")
  })
})

describe("PillGroup", () => {
  it("is a named group that wraps", () => {
    render(
      <PillGroup label="Status">
        <FilterPill selected>All</FilterPill>
        <FilterPill>Waiting</FilterPill>
      </PillGroup>
    )
    const group = screen.getByRole("group", { name: "Status" })
    expect(group.getAttribute("data-slot")).toBe("pill-group")
    expect(group.className).toContain("flex-wrap")
    expect(group.className).not.toContain("overflow-x")
    expect(within(group).getAllByRole("button")).toHaveLength(2)
  })

  it("takes its name from a visible label", () => {
    render(
      <>
        <span id="section-label">Section</span>
        <PillGroup aria-labelledby="section-label" label="Ignored">
          <FilterPill>Mains</FilterPill>
        </PillGroup>
      </>
    )
    const group = screen.getByRole("group", { name: "Section" })
    expect(group.hasAttribute("aria-label")).toBe(false)
  })
})

describe("ToggleGroup (internal)", () => {
  it("draws the grey track without being told a variant", () => {
    render(
      <ToggleGroup aria-label="Media type" defaultValue={["all"]}>
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="photos">Photos</ToggleGroupItem>
      </ToggleGroup>
    )
    const group = screen.getByRole("group", { name: "Media type" })
    expect(group.getAttribute("data-variant")).toBe("default")
    expect(group.className).toContain("data-[variant=default]:bg-surface-2")
    const all = screen.getByRole("button", { name: "All" })
    expect(all.getAttribute("aria-pressed")).toBe("true")
    expect(all.getAttribute("data-variant")).toBe("default")
    expect(all.className).toContain("aria-pressed:bg-surface")
    expect(all.className).toContain("min-h-11")
  })

  it("keeps the pill look for the outline variant", () => {
    render(
      <ToggleGroup variant="outline" aria-label="Filter" defaultValue={["a"]}>
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>
    )
    const item = screen.getByRole("button", { name: "A" })
    expect(item.getAttribute("data-variant")).toBe("outline")
    expect(item.className).toContain("aria-pressed:edge-selected")
    expect(item.className).not.toContain("aria-pressed:bg-surface ")
  })
})
