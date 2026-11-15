// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Heading } from "@/components/ui/heading"
import { Photo } from "@/components/ui/photo"
import { MAX_SEGMENTS, Progress } from "@/components/ui/progress"
import {
  Skeleton,
  SkeletonDetail,
  SkeletonFeed,
  SkeletonForm,
  SkeletonGrid,
  SkeletonList,
  SkeletonRegion,
} from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"

afterEach(cleanup)

describe("Heading", () => {
  it.each([
    [1, "H1", "page-title", "type-page-title"],
    [2, "H2", "section-title", "type-section-title"],
    [3, "H3", "heading-sm", "type-heading-sm"],
    [4, "H4", "item-title", "text-item-title"],
  ] as const)("level %i renders %s at %s", (level, tag, size, className) => {
    render(<Heading level={level}>Photos</Heading>)
    const heading = screen.getByRole("heading", { name: "Photos", level })
    expect(heading.tagName).toBe(tag)
    expect(heading.getAttribute("data-slot")).toBe("heading")
    expect(heading.getAttribute("data-size")).toBe(size)
    expect(heading.className).toContain(className)
    expect(heading.className).toContain("text-ink")
    expect(heading.className).toContain("text-balance")
  })

  it("is a level 2 section title unless told otherwise", () => {
    render(<Heading>Team</Heading>)
    expect(screen.getByRole("heading", { level: 2 }).className).toContain(
      "type-section-title"
    )
  })

  it("lets the size differ from the level", () => {
    render(
      <Heading level={3} size="display">
        Welcome
      </Heading>
    )
    const heading = screen.getByRole("heading", { level: 3 })
    expect(heading.className).toContain("type-display")
    expect(heading.className).not.toContain("type-heading-sm")
  })

  it("renders another element with `as`, and merges className last", () => {
    render(
      <Heading as="p" size="page-title" className="text-ink-muted" id="t">
        Not in the outline
      </Heading>
    )
    expect(screen.queryByRole("heading")).toBeNull()
    const text = screen.getByText("Not in the outline")
    expect(text.tagName).toBe("P")
    expect(text.id).toBe("t")
    expect(text.className).toContain("text-ink-muted")
    expect(text.className).not.toMatch(/(^| )text-ink( |$)/)
  })
})

describe("Progress, segments", () => {
  function segments(container: HTMLElement) {
    return [
      ...container.querySelectorAll<HTMLElement>(
        '[data-slot="progress-segment"]'
      ),
    ].map((segment) => segment.getAttribute("data-state"))
  }

  it("draws one segment per unit and is named by its visible words", () => {
    const { container } = render(
      <Progress
        mode="segments"
        accepted={3}
        submitted={1}
        total={5}
        label="3 of 5 accepted"
      />
    )
    const bar = screen.getByRole("progressbar", { name: "3 of 5 accepted" })
    expect(bar.getAttribute("aria-valuemin")).toBe("0")
    expect(bar.getAttribute("aria-valuemax")).toBe("5")
    expect(bar.getAttribute("aria-valuenow")).toBe("3")
    expect(bar.getAttribute("aria-valuetext")).toBe("3 of 5 accepted")
    expect(segments(container)).toEqual([
      "accepted",
      "accepted",
      "accepted",
      "submitted",
      "needed",
    ])
    const root = container.querySelector('[data-slot="progress"]')!
    expect(root.getAttribute("data-mode")).toBe("segments")
    expect(root.getAttribute("data-size")).toBe("md")
    // The words are on the page, not only in an attribute.
    const label = screen.getByText("3 of 5 accepted")
    expect(label.className).not.toContain("sr-only")
  })

  it("tells the three kinds apart by more than colour", () => {
    const { container } = render(
      <Progress
        mode="segments"
        accepted={1}
        submitted={1}
        total={3}
        label="1 of 3 accepted"
      />
    )
    const [accepted, submitted, needed] = container.querySelectorAll(
      '[data-slot="progress-segment"]'
    )
    expect(accepted.className).toContain("bg-ok-fg")
    expect(submitted.className).toContain("bg-stripe")
    expect(needed.className).toContain("edge-strong")
    // Blue never marks progress.
    expect(container.innerHTML).not.toMatch(/bg-(accent|select|info)/)
    // Forced colours: each kind keeps a border.
    for (const segment of [accepted, submitted, needed]) {
      expect(segment.className).toContain("forced-colors:border")
    }
  })

  it("keeps the label for screen readers when it is hidden", () => {
    render(
      <Progress
        mode="segments"
        accepted={1}
        total={3}
        label="1 of 3 accepted"
        labelHidden
      />
    )
    expect(
      screen.getByRole("progressbar", { name: "1 of 3 accepted" })
    ).toBeTruthy()
    expect(screen.getByText("1 of 3 accepted").className).toContain("sr-only")
  })

  it("draws 12 one by one and merges 13 into a bar", () => {
    const twelve = render(
      <Progress
        mode="segments"
        accepted={2}
        total={MAX_SEGMENTS}
        label="2 of 12 accepted"
      />
    )
    expect(segments(twelve.container)).toHaveLength(12)
    expect(screen.getByRole("progressbar").hasAttribute("data-merged")).toBe(
      false
    )
    twelve.unmount()

    const { container } = render(
      <Progress
        mode="segments"
        accepted={13}
        submitted={13}
        total={26}
        label="13 of 26 accepted"
      />
    )
    const bar = screen.getByRole("progressbar")
    expect(bar.hasAttribute("data-merged")).toBe(true)
    expect(bar.getAttribute("aria-valuemax")).toBe("26")
    expect(segments(container)).toEqual(["accepted", "submitted"])
    const fills = container.querySelectorAll<HTMLElement>(
      '[data-slot="progress-segment"]'
    )
    expect(fills[0].style.width).toBe("50%")
    expect(fills[1].style.width).toBe("50%")
  })

  it("clamps counts that run past the total", () => {
    const { container } = render(
      <Progress
        mode="segments"
        accepted={9}
        submitted={4}
        total={3}
        label="3 of 3 accepted"
      />
    )
    expect(segments(container)).toEqual(["accepted", "accepted", "accepted"])
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "3"
    )
  })

  it("shows a key for only the kinds it is given, and a compact size", () => {
    const { container } = render(
      <Progress
        mode="segments"
        size="sm"
        accepted={1}
        total={2}
        label="1 of 2 accepted"
        keyLabels={{ accepted: "Accepted", needed: "Still needed" }}
        className="mt-4"
      />
    )
    const root = container.querySelector('[data-slot="progress"]')!
    expect(root.getAttribute("data-size")).toBe("sm")
    expect(root.className).toContain("mt-4")
    const key = container.querySelector('[data-slot="progress-key"]')!
    expect(key.textContent).toBe("AcceptedStill needed")
    expect(
      container.querySelector('[data-slot="progress-segment"]')!.className
    ).toContain("h-2")
  })

  it("uses its own spoken value when the label is not plain text", () => {
    render(
      <Progress
        mode="segments"
        accepted={2}
        total={4}
        label={
          <>
            <strong>2</strong> of 4 accepted
          </>
        }
        valueText="2 of 4 accepted, 1 to review"
      />
    )
    const bar = screen.getByRole("progressbar", { name: "2 of 4 accepted" })
    expect(bar.getAttribute("aria-valuetext")).toBe(
      "2 of 4 accepted, 1 to review"
    )
  })
})

describe("Progress, bar", () => {
  it("is an ink bar by default (the spec's plain bar), named by aria-label", () => {
    const { container } = render(
      <Progress value={60} aria-label="Uploading" className="mt-1.5" />
    )
    const root = container.querySelector('[data-slot="progress"]')!
    expect(root.getAttribute("data-tone")).toBe("neutral")
    const fill = container.querySelector<HTMLElement>(
      '[data-slot="progress-indicator"]'
    )!
    // Ink unless the root says ok; never green by default.
    expect(fill.className.split(" ")).toContain("bg-ink")
    expect(fill.className.split(" ")).not.toContain("bg-ok-fg")
    expect(fill.className).toContain("group-data-[tone=ok]/progress:bg-ok-fg")
  })

  it("is a green bar for accepted work with tone ok", () => {
    const { container } = render(
      <Progress
        value={60}
        tone="ok"
        aria-label="3 of 5 accepted"
        className="mt-1.5"
      />
    )
    const bar = screen.getByRole("progressbar", { name: "3 of 5 accepted" })
    expect(bar.getAttribute("aria-valuemin")).toBe("0")
    expect(bar.getAttribute("aria-valuemax")).toBe("100")
    expect(bar.getAttribute("aria-valuenow")).toBe("60")
    expect(bar.getAttribute("aria-valuetext")).toBe("60%")
    const root = container.querySelector('[data-slot="progress"]')!
    expect(root.getAttribute("data-mode")).toBe("bar")
    expect(root.getAttribute("data-tone")).toBe("ok")
    expect(root.className).toContain("mt-1.5")
    const fill = container.querySelector<HTMLElement>(
      '[data-slot="progress-indicator"]'
    )!
    expect(fill.style.width).toBe("60%")
    expect(fill.className).toContain("group-data-[tone=ok]/progress:bg-ok-fg")
  })

  it("shows its label in words and takes the neutral tone", () => {
    const { container } = render(
      <Progress value={42} tone="neutral" label="Uploading 42%" />
    )
    expect(
      screen.getByRole("progressbar", { name: "Uploading 42%" })
    ).toBeTruthy()
    expect(
      container
        .querySelector('[data-slot="progress"]')!
        .getAttribute("data-tone")
    ).toBe("neutral")
  })

  it("takes the ok tone, a max and an aria-valuetext", () => {
    const { container } = render(
      <Progress
        value={5}
        max={10}
        tone="ok"
        aria-label="Menu photos"
        aria-valuetext="5 of 10 items"
      />
    )
    const bar = screen.getByRole("progressbar", { name: "Menu photos" })
    expect(bar.getAttribute("aria-valuemax")).toBe("10")
    expect(bar.getAttribute("aria-valuenow")).toBe("5")
    expect(bar.getAttribute("aria-valuetext")).toBe("5 of 10 items")
    expect(
      container
        .querySelector('[data-slot="progress"]')!
        .getAttribute("data-tone")
    ).toBe("ok")
  })

  it("gives no value when the amount is not known", () => {
    const { container } = render(
      <Progress value={null} aria-label="Processing photo 2" />
    )
    const bar = screen.getByRole("progressbar", { name: "Processing photo 2" })
    expect(bar.hasAttribute("aria-valuenow")).toBe(false)
    expect(bar.hasAttribute("data-indeterminate")).toBe(true)
    expect(
      container.querySelector('[data-slot="progress-indicator"]')!.className
    ).toContain("bg-stripe")
  })

  it("clamps a value outside its range", () => {
    render(<Progress value={140} aria-label="Done" />)
    const bar = screen.getByRole("progressbar")
    expect(bar.getAttribute("aria-valuenow")).toBe("100")
    expect(bar.getAttribute("aria-valuetext")).toBe("100%")
  })
})

describe("Photo", () => {
  it("is a lazy, async image in a 4:3 box with the placeholder fill", () => {
    const { container } = render(
      <Photo src="/a.jpg" alt="Chicken pie from the front" />
    )
    const img = screen.getByRole("img", { name: "Chicken pie from the front" })
    expect(img.getAttribute("loading")).toBe("lazy")
    expect(img.getAttribute("decoding")).toBe("async")
    expect(img.className).toContain("object-cover")
    const box = container.querySelector('[data-slot="photo"]')!
    expect(box.getAttribute("data-state")).toBe("loading")
    expect(box.getAttribute("data-ratio")).toBe("4/3")
    expect(box.className).toContain("aspect-4/3")
    expect(box.className).toContain("bg-media-placeholder")
    expect(box.className).toContain("rounded-control")
  })

  it("takes a ratio, a radius, eager loading, sizes and srcSet", () => {
    const { container } = render(
      <Photo
        src="/a.jpg"
        srcSet="/a.jpg 1x, /a@2x.jpg 2x"
        sizes="(min-width: 768px) 300px, 50vw"
        alt=""
        ratio="1/1"
        radius="none"
        eager
        className="max-w-40"
      />
    )
    const img = container.querySelector("img")!
    expect(img.getAttribute("loading")).toBe("eager")
    expect(img.getAttribute("srcset")).toBe("/a.jpg 1x, /a@2x.jpg 2x")
    expect(img.getAttribute("sizes")).toBe("(min-width: 768px) 300px, 50vw")
    const box = container.querySelector('[data-slot="photo"]')!
    expect(box.className).toContain("aspect-square")
    expect(box.className).toContain("rounded-none")
    expect(box.className).toContain("max-w-40")
  })

  it("marks itself loaded when the file arrives", () => {
    const onLoad = vi.fn()
    const { container } = render(
      <Photo src="/a.jpg" alt="Pie" onLoad={onLoad} />
    )
    fireEvent.load(container.querySelector("img")!)
    expect(
      container.querySelector('[data-slot="photo"]')!.getAttribute("data-state")
    ).toBe("loaded")
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Photo unavailable")).toBeNull()
  })

  it("says so in words when the file cannot be loaded, and lets the error reach a wrapper", () => {
    const onWrapperError = vi.fn()
    const onError = vi.fn()
    const { container } = render(
      <div onError={onWrapperError}>
        <Photo src="/api/media/x/thumb" alt="Pie" onError={onError} />
      </div>
    )
    const img = container.querySelector("img")!
    fireEvent.error(img)
    expect(
      container.querySelector('[data-slot="photo"]')!.getAttribute("data-state")
    ).toBe("broken")
    expect(screen.getByText("Photo unavailable")).toBeTruthy()
    expect(
      container.querySelector('[data-slot="photo-unavailable"] svg')
    ).not.toBeNull()
    // Preview recovery listens on a wrapper and reads the failed src.
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onWrapperError).toHaveBeenCalledTimes(1)
    expect(container.querySelector("img")).toBe(img)
    expect(img.getAttribute("src")).toBe("/api/media/x/thumb")
    expect(img.getAttribute("alt")).toBe("Pie")
  })

  it("starts again when it is given a re-signed address", () => {
    const { container, rerender } = render(
      <Photo src="/api/media/x/thumb" alt="Pie" />
    )
    fireEvent.error(container.querySelector("img")!)
    expect(screen.getByText("Photo unavailable")).toBeTruthy()
    rerender(<Photo src="/api/media/x/thumb?r=1" alt="Pie" />)
    expect(
      container.querySelector('[data-slot="photo"]')!.getAttribute("data-state")
    ).toBe("loading")
    expect(screen.queryByText("Photo unavailable")).toBeNull()
    expect(container.querySelector("img")!.getAttribute("src")).toBe(
      "/api/media/x/thumb?r=1"
    )
  })

  it("shows the message, with what is missing, when there is no file", () => {
    const { container } = render(
      <Photo src={undefined} alt="Lamb bhuna" unavailableLabel="No photo yet" />
    )
    expect(container.querySelector("img")).toBeNull()
    expect(
      container.querySelector('[data-slot="photo-unavailable"]')!.textContent
    ).toBe("Lamb bhuna. No photo yet")
  })
})

describe("Avatar", () => {
  it.each([
    ["sm", "size-9"],
    ["md", "size-11"],
    ["lg", "size-21"],
  ] as const)("size %s is %s", (size, className) => {
    const { container } = render(
      <Avatar size={size}>
        <AvatarFallback>MW</AvatarFallback>
      </Avatar>
    )
    const avatar = container.querySelector('[data-slot="avatar"]')!
    expect(avatar.getAttribute("data-size")).toBe(size)
    expect(avatar.className).toContain(className)
  })

  it("is md by default, with initials on the avatar tint at the type floor", () => {
    const { container } = render(
      <Avatar className="ring-2">
        <AvatarFallback>MW</AvatarFallback>
      </Avatar>
    )
    const avatar = container.querySelector('[data-slot="avatar"]')!
    expect(avatar.getAttribute("data-size")).toBe("md")
    expect(avatar.className).toContain("ring-2")
    const fallback = container.querySelector('[data-slot="avatar-fallback"]')!
    expect(fallback.textContent).toBe("MW")
    expect(fallback.className).toContain("bg-avatar-fill")
    expect(fallback.className).toContain("text-on-avatar")
    expect(fallback.className).toContain("text-label")
    // No size below 17px is written for any avatar.
    expect(fallback.className).not.toMatch(/text-\[1[0-6]px\]/)
  })

  it("ProfileAvatar is hidden beside a name and named when it stands alone", () => {
    const { container, rerender } = render(<ProfileAvatar name="Mina Walker" />)
    const hidden = container.querySelector('[data-slot="avatar"]')!
    expect(hidden.getAttribute("aria-hidden")).toBe("true")
    expect(hidden.getAttribute("data-size")).toBe("md")
    expect(hidden.textContent).toBe("MW")
    rerender(<ProfileAvatar name="Mina Walker" size="sm" labelled />)
    const named = screen.getByRole("img", { name: "Mina Walker" })
    expect(named.getAttribute("data-size")).toBe("sm")
  })
})

describe("Skeleton", () => {
  it("is hidden from screen readers and names its shape", () => {
    const { container } = render(<Skeleton shape="photo" />)
    const block = container.querySelector('[data-slot="skeleton"]')!
    expect(block.getAttribute("aria-hidden")).toBe("true")
    expect(block.getAttribute("data-shape")).toBe("photo")
    expect(block.className).toContain("aspect-4/3")
    expect(block.className).not.toMatch(/animate|pulse|shimmer/)
  })

  it("SkeletonRegion is busy and says what is loading once", () => {
    const { container } = render(
      <SkeletonRegion label="Loading photos…">
        <Skeleton shape="line" />
      </SkeletonRegion>
    )
    expect(screen.getByRole("status").textContent).toBe("Loading photos…")
    expect(
      container
        .querySelector('[data-slot="skeleton-region"]')!
        .getAttribute("aria-busy")
    ).toBe("true")
  })

  it.each([
    ["feed", <SkeletonFeed key="f" label="Loading posts…" count={2} />],
    ["list", <SkeletonList key="l" label="Loading posts…" count={2} />],
    ["grid", <SkeletonGrid key="g" label="Loading posts…" count={2} />],
    ["detail", <SkeletonDetail key="d" label="Loading posts…" />],
    ["form", <SkeletonForm key="o" label="Loading posts…" fields={2} />],
  ] as const)(
    "the %s recipe is one busy region with one status",
    (recipe, ui) => {
      const { container } = render(ui)
      const region = container.querySelector('[data-slot="skeleton-region"]')!
      expect(region.getAttribute("data-recipe")).toBe(recipe)
      expect(region.getAttribute("aria-busy")).toBe("true")
      expect(screen.getAllByRole("status")).toHaveLength(1)
      expect(screen.getByRole("status").textContent).toBe("Loading posts…")
      const blocks = container.querySelectorAll('[data-slot="skeleton"]')
      expect(blocks.length).toBeGreaterThan(1)
      for (const block of blocks) {
        expect(block.getAttribute("aria-hidden")).toBe("true")
      }
      expect(container.innerHTML).not.toMatch(/animate|pulse|shimmer/)
    }
  )

  it("draws as many rows, tiles and fields as it is asked for", () => {
    const list = render(
      <SkeletonList label="Loading…" count={5} avatar={false} />
    )
    expect(list.container.querySelectorAll('[data-shape="av"]')).toHaveLength(0)
    expect(
      list.container.querySelectorAll('[data-slot="skeleton"]')
    ).toHaveLength(10)
    list.unmount()
    const grid = render(<SkeletonGrid label="Loading…" count={4} />)
    expect(grid.container.querySelectorAll('[data-shape="tile"]')).toHaveLength(
      4
    )
  })
})

describe("Switch", () => {
  it("is a labelled switch that turns on and off with the keyboard", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <Switch aria-label="Account active" onCheckedChange={onCheckedChange} />
    )
    const control = screen.getByRole("switch", { name: "Account active" })
    expect(control.getAttribute("data-slot")).toBe("switch")
    expect(control.getAttribute("data-size")).toBe("md")
    expect(control.getAttribute("aria-checked")).toBe("false")
    expect(control.className).toContain("focus-ring")
    // 32px track, reaching 44px with the 6px hit area on each side.
    expect(control.className).toContain("h-8")
    expect(control.className).toContain("after:-inset-1.5")

    await user.tab()
    expect(document.activeElement).toBe(control)
    await user.keyboard(" ")
    expect(control.getAttribute("aria-checked")).toBe("true")
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    expect(onCheckedChange.mock.calls[0][0]).toBe(true)
    await user.keyboard("{Enter}")
    expect(control.getAttribute("aria-checked")).toBe("false")
  })

  it("has no small size", () => {
    render(
      // @ts-expect-error the 36px `sm` size is gone
      <Switch aria-label="Account active" size="sm" />
    )
    expect(screen.getByRole("switch").getAttribute("data-size")).toBe("md")
  })

  it("stays focusable but fixed with aria-disabled", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <>
        <Switch
          aria-label="Account active"
          aria-disabled
          aria-describedby="why"
          defaultChecked
          onCheckedChange={onCheckedChange}
        />
        <p id="why">You cannot change your own account.</p>
      </>
    )
    const control = screen.getByRole("switch", { name: "Account active" })
    expect(control.getAttribute("aria-disabled")).toBe("true")
    expect(control.getAttribute("aria-describedby")).toBe("why")
    expect(control.hasAttribute("disabled")).toBe(false)
    await user.tab()
    expect(document.activeElement).toBe(control)
    await user.keyboard(" ")
    await user.click(control)
    expect(control.getAttribute("aria-checked")).toBe("true")
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it("cannot be changed when disabled", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <Switch
        aria-label="Account active"
        disabled
        onCheckedChange={onCheckedChange}
      />
    )
    const control = screen.getByRole("switch")
    expect(control.hasAttribute("data-disabled")).toBe(true)
    // Base UI's own mark: without it a disabled switch is not announced as
    // unavailable (it is a span, so there is no native `disabled`).
    expect(control.getAttribute("aria-disabled")).toBe("true")
    await user.click(control)
    expect(onCheckedChange).not.toHaveBeenCalled()
    expect(control.getAttribute("aria-checked")).toBe("false")
  })

  it("carries aria-invalid and draws the invalid edge", () => {
    render(<Switch aria-label="Checked" aria-invalid />)
    const control = screen.getByRole("switch")
    expect(control.getAttribute("aria-invalid")).toBe("true")
    expect(control.className).toContain("aria-invalid:edge-invalid")
  })
})
